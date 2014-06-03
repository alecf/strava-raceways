from google.appengine.api import users

import json
from raceways.handler import BaseHandler, api_handler, authorized
from raceways.client import StravaClient
from google.appengine.ext import ndb
from raceways import model

class ActivitiesHandler(BaseHandler):
    @authorized
    @api_handler
    @ndb.toplevel
    def get(self):
        result = {
            'activities': []
            }

        athlete_id = self.get_athlete()['id']

        athlete = model.Athlete.get_by_id(id=athlete_id)

        activities = yield model.Activity.query(model.Activity.athlete_id == athlete_id).fetch_async()

        result['activities'].extend(activity.to_dict() for activity in activities)

        activity_streams = {}
        stream_keys = []
        stream_types = []
        for activity in result['activities']:
            for type in ('latlng', 'altitude'):
                if 'athlete_id' not in activity:
                    raise Exception("missing id from {}".format(sorted(activity.keys())))
                stream_key = '{}|v=2|type={}'.format(activity['activity_id'], type)
                stream_types.append(type)
                activity_streams[stream_key] = activity
                stream_keys.append(stream_key)

        streams = yield ndb.get_multi_async(ndb.Key(model.Stream, stream_key) for stream_key in stream_keys)

        for stream_key, stream_type, stream in zip(stream_keys, stream_types, streams):
            activity_streams[stream_key]['stream_{}'.format(stream_type)] = stream.to_dict()

        raise ndb.Return(result)
