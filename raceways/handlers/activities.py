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

        raise ndb.Return(result)
