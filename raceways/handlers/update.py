
API_PREFIX = 'https://www.strava.com/api/v3/'

from raceways import model
from raceways.client import api_call
from raceways.handler import BaseHandler, authorized
from google.appengine.ext import ndb
import json
import itertools

# from itertools docs
def pairwise(iterable):
    "s -> (s0,s1), (s1,s2), (s2, s3), ..."
    a, b = itertools.tee(iterable)
    next(b, None)
    return itertools.izip(a, b)

class UpdateHandler(BaseHandler):

    @authorized
    @ndb.toplevel
    def get(self):

        athlete_id = self.get_athlete()['id']

        athlete = model.Athlete.get_by_id(id=athlete_id)

        activities = yield self.arc.urlfetch(api_call('athlete/activities', id=athlete_id, per_page=20))

        strava_activities = json.loads(activities.content)

        import pprint

        pending_keys = []
        for activity in strava_activities:
            activity_id = activity['id']
            pending_keys.append(ndb.Key(model.Activity, str(activity_id)))

        activity_records = yield ndb.get_multi_async(pending_keys)

        self.response.write("Fetch complete with {} activities<br>".format(len(activity_records)))
        for activity_record in activity_records:
            self.response.write("Activity: <pre>{}</pre><br>".format(activity))
        missing_activities = [(key, strava_activity)
                              for key, strava_activity, record in itertools.izip(pending_keys,
                                                                           strava_activities,
                                                                           activity_records)
                              if record is None]
        pending_writes = []

        pending_stream_requests = []
        pending_stream_request_map = []
        pending_activity_requests = []
        for missing_key, strava_activity in missing_activities:
            self.response.write("Missing: {}<br>".format(missing_key.id()))
            f = self.arc.urlfetch(api_call('activities/{}/streams/latlng,altitude'.format(missing_key.id())))
            pending_stream_requests.append(f)
            pending_stream_request_map.append(missing_key.id())

            activity_record = model.Activity(id=missing_key.id())
            for key, value in strava_activity.iteritems():
                setattr(activity_record, key, value)
            pending_writes.append(activity_record.put_async())

        while pending_stream_requests:
            print "{} outstanding streams..".format(len(pending_stream_requests))
            f = ndb.Future.wait_any(pending_stream_requests)
            pos = pending_stream_requests.index(f)
            pending_stream_requests.remove(f)
            activity_id = pending_stream_request_map.pop(pos)
            
            streams = json.loads(f.get_result().content)

            for stream in streams:
                stream_type = stream['type']   # latlng or altitude
                stream_entity_id = "{}|v=2|type={}".format(activity_id, stream_type)
                stream_record = model.Stream(id=stream_entity_id)

                for key, value in stream.iteritems():
                    setattr(stream_record, key, value)

                pending_writes.append(stream_record.put_async())

        print "Waiting for {} writes to finish..".format(len(pending_writes))
        yield pending_writes

        raise ndb.Return(None)
