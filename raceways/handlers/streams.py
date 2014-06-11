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
        streams = result['streams']

        activity_ids = self.request.getall('activity_id')
        stream_ids = []
        stream_types = []
        for activity_id in activity_ids:
            streams[activity_id] = {}
            for type in ('latlng', 'altitude'):
                stream_id = '{}|v=2|type={}'.format(activity_id, type)
                stream_ids.append(stream_id)
                stream_types.append(type)

        streams = yield ndb.get_multi_async(
            ndb.Key(model.Stream, stream_id) for stream_id in stream_ids)

        for stream_id, stream_type, stream in zip(stream_ids, stream_types, streams):
            activity = streams[stream_id]
            if stream is None:
                activity[stream_type] = {}
            else:
                activity[stream_type] = stream.to_dict()
                
        raise ndb.Return(result)
