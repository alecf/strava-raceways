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
        activities = []
        for page in xrange(1, 10):
            if time.time() > (self.deadline - 30):
                break
            activities.extend(self.strava.athlete_activities(id=athlete_id, page=page, per_page=10))

        locations = defaultdict(int)
        for activity in activities:
            if time.time() > self.deadline:
                break
            
            latlng = self.strava.activity_stream(id=activity['id'], type='latlng', resolution='medium')
            altitude = self.strava.activity_stream(id=activity['id'], type='altitude', resolution='medium')
            activity['stream'] = { 'latlng': latlng, 'altitude': altitude }
            locations[(activity['location_city'], activity['location_state'], activity['location_country'])] += 1

        # set -> list
        locations = sorted(locations.iteritems(), key=lambda (key,value): value, reverse=True)
        locations = [list(loc) for loc,count in locations]

        return {
            'logout_url': users.create_logout_url('/'),
            'login_url': users.create_login_url('/'),
            'user': self.user,
            'athlete': athlete,
            'activities': activities,
            'locations': locations,
            }

