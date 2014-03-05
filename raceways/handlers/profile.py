from google.appengine.api import users

import json
from raceways.handler import BaseHandler, using_template
from raceways.client import StravaClient

class ProfileHandler(BaseHandler):
    @using_template('profile.html')
    def get(self):
        if not self.user or not self.strava_storage.get():
            return self.redirect('/')

        strava_credentials = self.strava_storage.get()
        
        strava_credentials.authorize(self.http)

        strava_credentials_json = json.loads(strava_credentials.to_json())

        client = StravaClient(self.http)
        
        athlete = client.athlete()
        activities = client.athlete_activities(page=1, per_page=10)

        return {
            'strava_credentials': strava_credentials_json,
            'logout_url': users.create_logout_url('/'),
            'login_url': users.create_login_url('/'),
            'user': self.user,
            'athlete': athlete,
            'activities': activities,
            }
