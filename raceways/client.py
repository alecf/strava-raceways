
import urllib
import json

def jsonresponse(f):
    def reply(*args, **kwds):
        header, body = f(*args, **kwds)
        return json.loads(body)
    return reply

api_prefix = 'https://www.strava.com/api/v3/'
def api_call(name, *url_segments, **params):
    url = api_prefix + name
    kwds = {}
    for kwd, value in params.iteritems():
        if value is not None:
            kwds[kwd] = value

    if url_segments:
        url += '/' + '/'.join(url_segments)

    if params:
        url += "?" + urllib.urlencode(kwds)
    print "Requesting {}".format(url)
    return url

class StravaClient(object):
    def __init__(self, http):
        self.http = http

    @jsonresponse
    def athlete(self, athlete_id=None):
        return self.http.request(api_call('athlete', id=athlete_id))

    @jsonresponse
    def athlete_activities(self, before=None, after=None, page=None, per_page=None):
        return self.http.request(api_call('athlete/activities', before=before, after=after, page=page, per_page=per_page))

    @jsonresponse
    def activity_stream(self, id, type):
        return self.http.request(api_call('activities', str(id), 'streams', type))
