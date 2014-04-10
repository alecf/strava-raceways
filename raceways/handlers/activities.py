from google.appengine.api import users

import json
from raceways.handler import BaseHandler, json_response, authorized
from raceways.client import StravaClient

class ActivitiesHandler(BaseHandler):
    @json_response
    @authorized
    def get(self):
        pass
