#!/usr/bin/env python3
"""Dev server for the scroll pages.

  ./_serve.py [port] [root]

python -m http.server sends neither Cache-Control nor ETag, only Last-Modified.
A browser given that is free to apply heuristic freshness and keep serving a
script out of its own disk cache without ever asking whether the file changed.
On a page whose entire behaviour lives in one long-lived JS file, that looks
exactly like the edit having no effect, and no amount of rewriting the edit
fixes it.

Everything here is sent no-store, and conditional requests are stripped so a
304 cannot hand the stale copy back either. A plain reload is always the file
on disk.
"""

import functools
import http.server
import sys


class Handler(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        # answered with a 304 by the base class otherwise, which would leave
        # the browser on the copy it already has
        del self.headers['If-Modified-Since']
        del self.headers['If-None-Match']
        return super().send_head()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, max-age=0')
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8777
    root = sys.argv[2] if len(sys.argv) > 2 else '.'
    handler = functools.partial(Handler, directory=root)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', port), handler)
    print('serving %s on http://localhost:%d/' % (root, port), flush=True)
    srv.serve_forever()


if __name__ == '__main__':
    main()
