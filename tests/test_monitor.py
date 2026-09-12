"""Loopback monitor state and bounded-history regressions; no actual model."""
import json,unittest
from types import SimpleNamespace
from websockets.datastructures import Headers
from tools.monitor_server import Hub,static_response

class Feed:
    def __init__(self,events):self.events=iter(events)
    def __aiter__(self):return self
    async def __anext__(self):
        try:return next(self.events)
        except StopIteration:raise StopAsyncIteration

class MonitorTests(unittest.IsolatedAsyncioTestCase):
    async def test_long_conversation_keeps_session_settings_after_history_rolls(self):
        hub=Hub(history=4)
        for role in (0,1):await hub.broadcast(json.dumps({'kind':'session','role':role,'session':123,'wpm':80.1}))
        for i in range(20):await hub.broadcast(json.dumps({'kind':'generated','role':i%2,'seq':i+1}))
        snapshot=[json.loads(text) for text in hub.snapshot_history()]
        self.assertEqual(len(hub.history),4)
        self.assertEqual([e['role'] for e in snapshot if e['kind']=='session'],[0,1])
        self.assertEqual(snapshot[-1]['seq'],20)

    async def test_marks_do_not_displace_session_or_verified_text(self):
        hub=Hub(history=6)
        await hub.broadcast(json.dumps({'kind':'session','role':0,'session':123}))
        for i in range(1000):await hub.broadcast(json.dumps({'kind':'mark','role':0,'units':1}))
        await hub.broadcast(json.dumps({'kind':'frame','role':0,'frame':{'text':'受信本文'}}))
        self.assertEqual([json.loads(e)['kind'] for e in hub.history],['session','frame'])

    async def test_feed_close_reports_exact_role_and_preserves_other_endpoint(self):
        hub=Hub();other=object();hub.feed_roles[other]={1};hub.feeds.add(other)
        events=[]
        async def record(text):events.append(json.loads(text))
        hub.broadcast=record
        await hub.feed(Feed(['null','[]','invalid',json.dumps({'kind':'hello','role':0})]))
        self.assertEqual(events[-1]['kind'],'feed-close')
        self.assertEqual(events[-1]['role'],0)
        self.assertEqual(events[-1]['roles'],[1])
        self.assertEqual(events[-1]['feeds'],1)

    async def test_stopped_role_is_not_advertised_as_connected(self):
        hub=Hub();hub.feed_roles[object()]={0,1};hub.stopped.add(0)
        self.assertEqual(hub.roles(),[1])

    async def test_conversation_start_is_same_origin_only(self):
        for origin in ('https://outside.example', '', 'http://localhost:99'):
            request=SimpleNamespace(path='/conversation',headers=Headers([('Host','127.0.0.1:18790'),('Origin',origin)]))
            self.assertEqual(static_response(None,request).status_code,403)
        request=SimpleNamespace(path='/conversation',headers=Headers([('Host','127.0.0.1:18790'),('Origin','http://127.0.0.1:18790')]))
        self.assertIsNone(static_response(None,request))

    async def test_backend_workers_are_counted_without_a_frontend_feed(self):
        hub=Hub();hub.backend_roles={0,1}
        self.assertEqual(hub.roles(),[0,1]);self.assertEqual(hub.feed_count(),2)

if __name__=='__main__':unittest.main()
