
import urllib
import json
from functools import wraps
import time
from raceways.model import Athlete, Stream

def jsonresponse(f):
    @wraps(f)
    def reply(*args, **kwds):
        now = time.time()
        headers, body = f(*args, **kwds)
        print "Uncached handler took {}s".format(time.time() - now)
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
        url += "?" + urllib.urlencode(sorted(kwds.iteritems()))
    print "Requesting {}".format(url)
    return url

KEY_VERSION = 1
def entity(ModelClass, subkey=None):
    def decorator(f):
        f.model_class = ModelClass
        @wraps(f)
        def wrapper(self, id=None, *args, **kwds):
            if id is not None:
                entity_id = str(id) + "|v={}".format(KEY_VERSION)
                if args:
                    entity_id += "|" + "|".join(*args)
                if kwds:
                    entity_id += "|" + "|".join("{}={}".format(key, value)
                                                for key,value in kwds.iteritems())
                model_entity = ModelClass.get_by_id(entity_id)
                if model_entity is not None:
                    return model_entity.to_dict()
            now = time.time()
            header, body = f(self, id=id, *args, **kwds)
            print "Took {}s".format(time.time() - now)
            json_data = json.loads(body)
            # this is a massive hack to deal with streams which return dictionary objects?!
            if subkey:
                subkey_value = kwds.get(subkey)
                assert subkey_value, "Must specify key '{}' in query".format(subkey)
                new_data = { 'data': [] }
                for entry in json_data:
                    if entry[subkey] == subkey_value:
                        new_data = entry
                # assert new_data, "Didn't get any entry back with {}={}".format(subkey, subkey_value)
                json_data = new_data

            model_entity = ModelClass(id=entity_id)
            for key, value in json_data.iteritems():
                if key != 'id':
                    setattr(model_entity, key, value)
            model_entity.put()
            return json_data
            
        return wrapper
    return decorator
    

class StravaClient(object):
    def __init__(self, http):
        self.http = http

    @entity(Athlete)
    def athlete(self, id=None):
        return self.http.request(api_call('athlete', id=id))

    @jsonresponse
    def athlete_activities(self, id=None, before=None, after=None, page=None, per_page=None):
        return self.http.request(api_call('athlete/activities', id=id, before=before, after=after, page=page, per_page=per_page))

    @entity(Stream, subkey='type')
    def activity_stream(self, id=None, type=None, resolution=None, series_type=None):
        return self.http.request(api_call('activities', str(id), 'streams', type,
                                          resolution=resolution, series_type=series_type))
