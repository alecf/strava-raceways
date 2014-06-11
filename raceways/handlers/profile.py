from google.appengine.api import users

import time
from collections import defaultdict
from raceways.handler import BaseHandler, using_template, authorized

class ProfileHandler(BaseHandler):
    @authorized
    @using_template('profile.html')
    def get(self):
        athlete_id = self.get_athlete()['id']
        athlete = self.strava.athlete(id=athlete_id)
        return {
            'logout_url': users.create_logout_url('/'),
            'login_url': users.create_login_url('/'),
            'user': self.user,
            'athlete': athlete,
            }

