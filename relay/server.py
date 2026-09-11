#!/usr/bin/env python3
"""Bounded, memory-only two-party relay. The end-to-end secret is never sent here.
Run behind TLS (WSS); loopback WS is for development. No HTTP AI proxy or storage.
"""
from __future__ import annotations
import asyncio
import json
import logging
import os
import re
import secrets
import time
from dataclasses import dataclass, field
from http import HTTPStatus
from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed

B64_16 = re.compile(r'[A-Za-z0-9_-]{22}\Z')
B64_32 = re.compile(r'[A-Za-z0-9_-]{43}\Z')
B64 = re.compile(r'[A-Za-z0-9_-]+\Z')
LOCAL_ORIGIN = re.compile(r'http://(127\.0\.0\.1|localhost):[0-9]{1,5}\Z')
TTL_MS = 900_000

@dataclass
class Room:
    auth: str
    expires: int
    peers: dict = field(default_factory=dict)
    used: bool = False
    closed: bool = False

class Relay:
    def __init__(self, max_rooms=128, max_connections=256, per_ip=16):
        self.rooms: dict[str, Room] = {}
        self.max_rooms, self.max_connections, self.per_ip = max_rooms, max_connections, per_ip
        self.connections = set()
        self.by_ip = {}

    def sweep(self):
        now = int(time.time()*1000)
        for key, room in list(self.rooms.items()):
            if room.expires <= now and not room.peers:
                del self.rooms[key]

    async def reject(self, ws, code):
        # Stable error category, never echo keys, bodies, URLs or client input.
        try:
            await asyncio.wait_for(ws.send(json.dumps({'t':'error', 'code':code})), 2)
        finally:
            await ws.close(1008, 'Session unavailable')

    async def handler(self, ws):
        ip = ws.remote_address[0] if ws.remote_address else 'unknown'
        if len(self.connections) >= self.max_connections or self.by_ip.get(ip,0) >= self.per_ip:
            await self.reject(ws, 'capacity');return
        self.connections.add(ws);self.by_ip[ip] = self.by_ip.get(ip,0)+1
        room = None;side = None
        try:
            raw = await asyncio.wait_for(ws.recv(), 8)
            if not isinstance(raw,str) or len(raw)>512:
                await self.reject(ws,'join');return
            data=json.loads(raw);now=int(time.time()*1000)
            if (not isinstance(data,dict) or set(data)!={'t','v','room','auth','side','expires'} or
                data['t']!='join' or type(data['v']) is not int or data['v']!=1 or
                type(data['side']) is not int or data['side'] not in (0,1) or
                not isinstance(data['room'],str) or not B64_16.fullmatch(data['room']) or
                not isinstance(data['auth'],str) or not B64_32.fullmatch(data['auth']) or
                type(data['expires']) is not int or not now<data['expires']<=now+TTL_MS+5000):
                await self.reject(ws,'join');return
            self.sweep();rid=data['room'];candidate=self.rooms.get(rid)
            if candidate is None:
                if len(self.rooms)>=self.max_rooms:
                    await self.reject(ws,'capacity');return
                candidate=Room(data['auth'],data['expires']);self.rooms[rid]=candidate
            if (not secrets.compare_digest(candidate.auth,data['auth']) or candidate.expires!=data['expires'] or
                    candidate.closed or data['side'] in candidate.peers):
                await self.reject(ws,'occupied-or-expired');return
            room=candidate;side=data['side'];room.peers[side]=ws
            if len(room.peers)==2:
                room.used=True
                # Snapshot: don't traverse a dict that another closing coroutine changes.
                await asyncio.gather(*(peer.send('{"t":"paired"}') for peer in list(room.peers.values())))
            else:
                await ws.send('{"t":"waiting"}')
            tokens=32.0;last=time.monotonic();count=0
            while True:
                remaining=room.expires/1000-time.time()
                if remaining<=0:break
                raw=await asyncio.wait_for(ws.recv(),remaining)
                now=time.monotonic();tokens=min(32.0,tokens+(now-last)*8);last=now
                if not isinstance(raw,str) or len(raw)>11000 or tokens<1 or count>=512:
                    await self.reject(ws,'limit');break
                tokens-=1;count+=1;box=json.loads(raw)
                if (not isinstance(box,dict) or set(box)!={'t','from','iv','body'} or box['t']!='box' or
                    type(box['from']) is not int or box['from']!=side or
                    not isinstance(box['iv'],str) or len(box['iv'])!=16 or not B64.fullmatch(box['iv']) or
                    not isinstance(box['body'],str) or not 22<=len(box['body'])<=9800 or not B64.fullmatch(box['body'])):
                    await self.reject(ws,'envelope');break
                other=room.peers.get(1-side)
                if other is None or room.closed:
                    await self.reject(ws,'peer-missing');break
                await asyncio.wait_for(other.send(raw),3)
        except (ConnectionClosed,TimeoutError,ValueError,TypeError,KeyError):
            pass
        finally:
            if room is not None and room.peers.get(side) is ws:
                room.peers.pop(side,None)
                # Tombstone until expiry; no same-invitation role takeover or reconnect.
                room.closed=True
                await asyncio.gather(*(peer.close(1000,'Peer disconnected') for peer in list(room.peers.values())),return_exceptions=True)
            self.connections.discard(ws);self.by_ip[ip]-=1
            if self.by_ip[ip]==0:del self.by_ip[ip]
            await ws.close()


def process_request(connection, request):
    if request.path=='/healthz':
        return connection.respond(HTTPStatus.OK,'MorseTalk relay ready\n')
    if request.path!='/v1':
        return connection.respond(HTTPStatus.NOT_FOUND,'Not found\n')
    return None

async def main():
    host=os.environ.get('HOST','127.0.0.1');port=int(os.environ.get('PORT','8787'))
    origins=['https://appassets.androidplatform.net',LOCAL_ORIGIN]
    for value in filter(None,os.environ.get('ALLOWED_ORIGINS','').split(',')):
        if not re.fullmatch(r'https://[A-Za-z0-9.:-]+',value):raise ValueError('ALLOWED_ORIGINS needs exact HTTPS origins')
        origins.append(value)
    relay=Relay()
    async with serve(relay.handler,host,port,origins=origins,process_request=process_request,
                     max_size=11000,max_queue=8,write_limit=16384,ping_interval=20,ping_timeout=20,
                     close_timeout=2,open_timeout=8,compression=None,server_header=None):
        print(f'MorseTalk relay listening on port {port}; TLS reverse proxy required for internet use',flush=True)
        await asyncio.Future()

if __name__=='__main__':
    logging.getLogger('websockets.server').setLevel(logging.CRITICAL)
    try:asyncio.run(main())
    except KeyboardInterrupt:pass
