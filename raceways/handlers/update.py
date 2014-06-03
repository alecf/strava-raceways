
API_PREFIX = 'https://www.strava.com/api/v3/'

from raceways import model
from raceways.client import api_call
from raceways.handler import BaseHandler, authorized, api_handler
from google.appengine.ext import ndb
import json
import itertools

# from itertools docs
def pairwise(iterable):
    "s -> (s0,s1), (s1,s2), (s2, s3), ..."
    a, b = itertools.tee(iterable)
    next(b, None)
    return itertools.izip(a, b)


@ndb.tasklet
def load_activities(activity_ids):
    pending_keys = []
    for activity_id in activity_ids:
        pending_keys.append(ndb.Key(model.Activity, activity_id))

    result = (pending_keys, ndb.get_multi_async(pending_keys))
    raise ndb.Return(result)

class UpdateHandler(BaseHandler):

    @authorized
    @api_handler
    @ndb.toplevel
    def get(self):
        result = {
            'activities': []
            }
        athlete_id = self.get_athlete()['id']

        athlete = model.Athlete.get_by_id(id=athlete_id)

        activities = yield self.arc.urlfetch(api_call('athlete/activities', id=athlete_id, per_page=10))

        strava_activities = json.loads(activities.content)
        result['total_activities'] = len(strava_activities)
        pending_keys, activity_records = yield load_activities([activity['id'] for activity in strava_activities])

        activity_records = yield activity_records
        missing_activities = [(key, strava_activity)
                              for key, strava_activity, record in itertools.izip(pending_keys,
                                                                                 strava_activities,
                                                                                 activity_records)
                              if record is None]
        pending_writes = []

        # Map of future -> activity_id
        pending_stream_requests = {}
        for missing_key, strava_activity in missing_activities:
            f = self.arc.urlfetch(api_call('activities/{}/streams/latlng,altitude'.format(missing_key.id())))
            pending_stream_requests[f] = missing_key.id()

            activity_record = model.Activity(id=missing_key.id())
            for key, value in strava_activity.iteritems():
                setattr(activity_record, key, value)
            activity_record.athlete_id = strava_activity['athlete']['id']
            activity_record.activity_id = strava_activity['id']
            
            result['activities'].append(strava_activity)
            pending_writes.append(activity_record.put_async())

        while pending_stream_requests:
            f = ndb.Future.wait_any(pending_stream_requests.keys())
            print "Have stream.."
            activity_id = pending_stream_requests[f]
            del pending_stream_requests[f]
            
            streams = json.loads(f.get_result().content)

            for stream in streams:
                stream_type = stream['type']   # latlng or altitude
                stream_entity_id = "{}|v=2|type={}".format(activity_id, stream_type)
                stream_record = model.Stream(id=stream_entity_id)

                for key, value in stream.iteritems():
                    setattr(stream_record, key, value)

                pending_writes.append(stream_record.put_async())

        print "Awaiting {} writes...".format(len(pending_writes))
        yield pending_writes

        raise ndb.Return(result)
