import json

from raceways.handler import BaseHandler, using_template
from stravalib import unithelper

class OauthCallbackHandler(BaseHandler):

    @using_template('widget.html')
    def get(self):
        # basic user loging
        return {}
    
