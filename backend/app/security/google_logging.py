"""Keep OAuth authorization codes/state out of Uvicorn access logs."""
import logging


class GoogleCallbackFilter(logging.Filter):
    def filter(self, record):
        if isinstance(record.args, tuple):
            record.args = tuple(
                item.split('?', 1)[0] + '?[redacted]'
                if isinstance(item, str) and '/api/auth/google/callback?' in item else item
                for item in record.args)
        return True


def install():
    logger = logging.getLogger('uvicorn.access')
    if not any(isinstance(item, GoogleCallbackFilter) for item in logger.filters):
        logger.addFilter(GoogleCallbackFilter())
