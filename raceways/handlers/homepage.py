import json
from google.appengine.api import users
from raceways.handler import BaseHandler, using_template
from stravalib import unithelper

class HomepageHandler(BaseHandler):
    @using_template('test.html')
    def get(self):
        # basic user login
        strava_auth_uri = None
        if self.user:
            # store strava auth in session (eventually want to store this
            # along side the user!)
            strava_credentials = self.strava_storage.get()
            if not strava_credentials:
                strava_auth_uri = self.strava_flow.step1_get_authorize_url()

            else:
                strava_credentials.authorize(self.http)
        else:
            strava_credentials = None

        template = self.get_template('test.html')

        strava_credentials_json = {}
        if strava_credentials:
            strava_credentials_json = json.loads(strava_credentials.to_json())
            print json.dumps(strava_credentials_json, indent=4)
        else:
            athlete = None
            activities = []
            stream = []

        print help(self.user)
        print "User has: %s" % dir(self.user)
        template_values = {
            'strava_credentials': strava_credentials_json,
            'strava_login_url': strava_auth_uri,
            'logout_url': '/logout',
            'login_url': '/login',
            'user': self.user,
            }
        return template_values
