"""Bound the CSV JSON envelope before FastAPI parses it, including chunked bodies."""
from starlette.responses import JSONResponse
from fastapi import HTTPException


class AssessmentBodyLimitMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or not scope.get('path', '').startswith(('/api/assessment-management','/api/candidate-management','/api/candidate-access')):
            return await self.app(scope, receive, send)
        cap = 4 * 1024 * 1024 if scope.get('path','').startswith('/api/assessment-management') else 128 * 1024
        try:
            declared = int(dict(scope.get('headers', [])).get(b'content-length', b'0'))
            if declared < 0:
                raise ValueError()
        except ValueError:
            return await JSONResponse({'detail': 'Invalid Content-Length'}, 400)(scope, receive, send)
        if declared > cap:
            return await JSONResponse({'detail': 'Assessment request exceeds 4 MB'}, 413)(scope, receive, send)
        size = 0
        class TooLarge(HTTPException):
            pass
        async def bounded_receive():
            nonlocal size
            message = await receive()
            size += len(message.get('body', b''))
            if size > cap:
                raise TooLarge(413, 'Assessment request exceeds 4 MB')
            return message
        started = False
        async def tracked_send(message):
            nonlocal started
            if message['type'] == 'http.response.start':
                started = True
            await send(message)
        try:
            await self.app(scope, bounded_receive, tracked_send)
        except TooLarge:
            if not started:
                await JSONResponse({'detail': 'Assessment request exceeds 4 MB'}, 413)(scope, receive, send)
