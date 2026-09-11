"""USB orchestration unit tests. ADB is a named test double, never real hardware."""
import asyncio
from pathlib import Path
import socket
import subprocess
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from tools.pc_android import UsbBridge, choose_device, valid_port, run_session

class DeviceSelectionTests(unittest.TestCase):
    def test_single_authorized_device(self):
        self.assertEqual(choose_device('List of devices attached\nphone-1\tdevice\n'),'phone-1')
    def test_untrusted_or_unavailable_states_are_not_bypassed(self):
        for state in ['unauthorized','offline','recovery','sideload']:
            with self.subTest(state=state),self.assertRaises(ValueError):choose_device('x\t'+state)
    def test_no_device(self):
        with self.assertRaises(ValueError):choose_device('List of devices attached\n')
    def test_multiple_devices_require_explicit_selection(self):
        data='phone\tdevice\nemulator-5554\tdevice\n'
        with self.assertRaises(ValueError):choose_device(data)
        self.assertEqual(choose_device(data,'phone'),'phone')
    def test_does_not_select_wrong_phone_when_another_is_unauthorized(self):
        with self.assertRaises(ValueError):choose_device('one device\ntwo unauthorized')
    def test_invalid_serial_is_not_a_shell_command(self):
        with self.assertRaises(ValueError):choose_device('x;echo device')
        with self.assertRaises(ValueError):UsbBridge('adb','x;echo')
    def test_requested_device_must_be_present_and_authorized(self):
        for serial in ['other','x']:
            with self.assertRaises(ValueError):choose_device('x unauthorized',serial)
    def test_ports(self):
        for value in [0,1,1023,65536,True,'8787']:
            with self.subTest(value=value),self.assertRaises(ValueError):valid_port(value)
        self.assertEqual(valid_port(8787),8787)

class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.mapping={};self.calls=[];self.bridge=UsbBridge('adb','phone')
        def command(*args):
            self.calls.append(args)
            if args==('reverse','--list'):
                return '\n'.join('phone '+key+' '+value for key,value in self.mapping.items())
            if args[:2]==('reverse','--no-rebind'):
                self.mapping[args[2]]=args[3];return ''
            if args[:2]==('reverse','--remove'):
                self.mapping.pop(args[2]);return ''
            raise AssertionError(args)
        self.bridge.command=command
    def test_exactly_one_owned_mapping_is_removed(self):
        self.mapping['tcp:9999']='tcp:9999'
        self.bridge.attach();self.assertTrue(self.bridge.owned)
        self.assertIn(('reverse','--no-rebind','tcp:8787','tcp:8787'),self.calls)
        self.bridge.detach();self.bridge.detach()
        self.assertEqual(self.mapping,{'tcp:9999':'tcp:9999'})
    def test_existing_mapping_is_never_rebound_or_removed(self):
        self.mapping['tcp:8787']='tcp:1234'
        with self.assertRaises(RuntimeError):self.bridge.attach()
        self.bridge.detach();self.assertEqual(self.mapping['tcp:8787'],'tcp:1234')
        self.assertFalse(any('--remove' in a or '--no-rebind' in a for a in self.calls))
    def test_replaced_mapping_is_preserved(self):
        self.bridge.attach();self.mapping['tcp:8787']='tcp:9000';self.bridge.detach()
        self.assertEqual(self.mapping['tcp:8787'],'tcp:9000')
    def test_attach_failure_does_not_claim_ownership(self):
        with patch.object(self.bridge,'command',side_effect=['',RuntimeError('failure')]):
            with self.assertRaises(RuntimeError):self.bridge.attach()
        self.assertFalse(self.bridge.owned)
    def test_adb_uses_argument_list_and_selected_serial(self):
        bridge=UsbBridge('/adb path/adb','phone')
        with patch('subprocess.run',return_value=subprocess.CompletedProcess([],0,'ok','')) as call:
            self.assertEqual(bridge.command('reverse','--list'),'ok')
            self.assertEqual(call.call_args.args[0],['/adb path/adb','-s','phone','reverse','--list'])
            self.assertNotIn('shell',call.call_args.kwargs)
    def test_double_attach_fails_without_rebinding(self):
        self.bridge.attach()
        with self.assertRaises(RuntimeError):self.bridge.attach()
        self.bridge.detach()

class SessionTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_loopback_relay_and_owned_cleanup(self):
        from websockets.asyncio.client import connect
        with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
        bridge=UsbBridge('adb','phone',port);stop=asyncio.Event();attached=asyncio.Event()
        with patch.object(bridge,'attach',side_effect=attached.set) as attach,patch.object(bridge,'detach') as detach:
            task=asyncio.create_task(run_session(bridge,open_browser=False,stop_event=stop))
            try:
                await asyncio.wait_for(attached.wait(),5)
                # Valid WebSocket session; no browser/microphone/model is simulated as real.
                async with connect(f'ws://127.0.0.1:{port}/v1',origin='https://appassets.androidplatform.net') as ws:
                    self.assertIsNotNone(ws)
                stop.set();await asyncio.wait_for(task,5)
                attach.assert_called_once();detach.assert_called_once()
            finally:
                stop.set()
                if not task.done():task.cancel()
                await asyncio.gather(task,return_exceptions=True)
    async def test_occupied_host_port_does_not_touch_android(self):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0));sock.listen();port=sock.getsockname()[1]
            bridge=UsbBridge('adb','phone',port)
            with patch.object(bridge,'attach') as attach:
                with self.assertRaises(OSError):await run_session(bridge,open_browser=False)
                attach.assert_not_called()

if __name__=='__main__':unittest.main()
