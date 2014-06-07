
API_PREFIX = 'https://www.strava.com/api/v3/'

from raceways import model
from raceways.client import api_call
from raceways.handler import BaseHandler, authorized, api_handler
from google.appengine.ext import ndb
import json
from itertools import tee, izip, islice

# from itertools docs
def pairwise(iterable):
    "s -> (s0,s1), (s1,s2), (s2, s3), ..."
    a, b = tee(iterable)
    return zip(islice(a, 0, None, 2), islice(b, 1, None, 2))


@ndb.tasklet
def load_activities(activity_ids):
    pending_keys = []
    for activity_id in activity_ids:
        pending_keys.append(ndb.Key(model.Activity, activity_id))

    result = pending_keys, ndb.get_multi_async(pending_keys)
    raise ndb.Return(result)


def format_stream_key(activity_id, stream_type):
    return "{}|v=2|type={}".format(activity_id, stream_type)

class UpdateHandler(BaseHandler):

    @authorized
    @api_handler
    @ndb.toplevel
    def get(self):
        result = {
            'new_activities': []
            }
        athlete_id = self.get_athlete()['id']
        per_page = self.request.get('count', 10)
        try:
            per_page = int(per_page)
        except ValueError as e:
            per_page = 10

        pending_writes = []

        athlete = model.Athlete.get_by_id(id=athlete_id)

        activities = yield self.arc.urlfetch(api_call('athlete/activities', id=athlete_id, per_page=per_page))

        strava_activities = json.loads(activities.content)
        result['total_activities'] = len(strava_activities)
        pending_keys, activity_records = yield load_activities([activity['id'] for activity in strava_activities])

        # print "Loading activities from {}".format(activity_records)
        activity_records = yield activity_records
        activity_requests = []
        for index, key, strava_activity, record in zip(xrange(len(pending_keys)),
                                                        pending_keys,
                                                        strava_activities,
                                                        activity_records):
            if record is None:
                activity_requests.append((index, key, strava_activity))

        print "Loading {} missing records: {}".format(len(activity_requests),
                                                      ','.join([str(a[2]['id']) for a in activity_requests]))
                
        for index, missing_key, strava_activity in activity_requests:
            activity_record = model.Activity(id=missing_key.id())
            for key, value in strava_activity.iteritems():
                setattr(activity_record, key, value)
            activity_record.athlete_id = strava_activity['athlete']['id']
            activity_record.activity_id = strava_activity['id']

            assert activity_records[index] is None
            activity_records[index] = activity_record
            result['new_activities'].append(strava_activity)
            pending_writes.append(activity_record.put_async())

        print "Now we have {} valid records...looking for their streams!".format(len(activity_records))
        
        # now pick up missing streams
        pending_stream_keys = []
        for activity_record in activity_records:
            for stream_type in ('latlng', 'altitude'):
                stream_key = ndb.Key(model.Stream,
                                     format_stream_key(activity_record.key.id(), stream_type))
                # for pairwise() later
                pending_stream_keys.append(stream_key)

        # load all streams from the database (!)
        print "Looking up {} stream key pairs..".format(len(pairwise(pending_stream_keys)))
        stream_records = yield ndb.get_multi_async(pending_stream_keys)
        # resolve futures
        
        stream_requests = []
        print "zipping up {} activities and {} record pairs".format(len(strava_activities), len(pairwise(stream_records)))
        for activity_record, (latlng_stream, altitude_stream) in zip(activity_records,
                                                                     pairwise(stream_records)):
            if latlng_stream is None or altitude_stream is None:
                stream_requests.append(activity_record.key.id())
            else:
                print "Have lat and lng for activity: {} / {} / {}".format(activity_record.key.id(),
                                                                           latlng_stream.key.id(),
                                                                           altitude_stream.key.id())

        print "Missing {} streams, fetching".format(len(stream_requests))
        pending_stream_requests = yield self.fetch_streams(stream_requests)

        while pending_stream_requests:
            f = ndb.Future.wait_any(pending_stream_requests.keys())
            activity_id = pending_stream_requests[f]
            del pending_stream_requests[f]
            
            streams = json.loads(f.get_result().content)

            for stream in streams:
                stream_type = stream['type']   # latlng or altitude
                stream_entity_id = format_stream_key(activity_id, stream_type)
                stream_record = model.Stream(id=stream_entity_id)

                for key, value in stream.iteritems():
                    setattr(stream_record, key, value)
                stream_record.activity_id = activity_id

                pending_writes.append(stream_record.put_async())

        print "Awaiting {} writes...".format(len(pending_writes))
        yield pending_writes

        raise ndb.Return(result)

    @ndb.tasklet
    def fetch_streams(self, activity_ids):
        pending_stream_requests = {}
        for id in activity_ids:
            f = self.arc.urlfetch(api_call('activities/{}/streams/latlng,altitude'.format(id)))
            pending_stream_requests[f] = id

        raise ndb.Return(pending_stream_requests)
