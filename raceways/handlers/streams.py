from google.appengine.api import users

import json
from raceways.handler import BaseHandler, api_handler, authorized
from raceways.client import StravaClient
from google.appengine.ext import ndb
from raceways import model

class StreamsHandler(BaseHandler):

    @authorized
    @api_handler
    @ndb.toplevel
    def get(self):
        result = {
            'streams': {}
            }
        streams_result = result['streams']

        activity_ids = self.request.GET.getall('activity_id')
        resolution = self.request.get('resolution')
        stream_keys = []
        stream_types = []
        activity_ids2 = []
        for activity_id in activity_ids:
            streams_result[activity_id] = {}
            for type in ('latlng', 'altitude'):
                stream_key = ndb.Key(
                    model.Stream,
                    model.Stream.make_key_string(activity_id, type, resolution=resolution))
                stream_keys.append(stream_key)
                stream_types.append(type)
                activity_ids2.append(activity_id)

        streams = yield ndb.get_multi_async(stream_keys)

        for activity_id, stream_type, stream in zip(activity_ids2, stream_types, streams):
            activity = streams_result[activity_id]
            if stream is None:
                activity[stream_type] = {}
            else:
                activity[stream_type] = stream.to_dict()

        self.response.cache_expires(60)
        raise ndb.Return(result)
