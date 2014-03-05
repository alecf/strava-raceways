
from raceways.handler import BaseHandler

class LoginHandler(BaseHandler):
    def get(self):
        if 'code' in self.request.GET:
            code = self.request.GET['code']
            credentials = self.strava_flow.step2_exchange(code)
            self.strava_storage.put(credentials)
            return self.redirect('/')

