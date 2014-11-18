from google.appengine.api import users

import time
from collections import defaultdict
from raceways.handler import BaseHandler, api_handler, authorized
from raceways import model

class UserInfoHandler(BaseHandler):
    @authorized
    @api_handler
    def get(self):
        result = {
            }

        athlete_id = self.get_athlete()['id']
        athlete = model.Athlete.get_by_id(id=athlete_id)
        result['user'] = {
            'nickname': self.user.nickname(),
            'email': self.user.email(),
            'identity': self.user.federated_identity(),
            }
        if athlete:
            result['athlete'] = athlete.to_dict()

        return result
