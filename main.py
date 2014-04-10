#!/usr/bin/env python
#
# Copyright 2007 Google Inc.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
import webapp2
import httplib2
import urllib
import json

from google.appengine.api import oauth, users, memcache, urlfetch

from raceways import JINJA_ENVIRONMENT
from raceways.handler import BaseHandler
from raceways.handlers.login import LoginHandler
from raceways.handlers.homepage import HomepageHandler
from raceways.handlers.profile import ProfileHandler
from raceways.api import ActivityListHandler,StreamHandler

from stravalib.client import Client
from stravalib import unithelper

class DisconnectStravaHandler(BaseHandler):
    def get(self):
        if not self.user:
            print "User wasn't logged in, redirecting"
            self.redirect(self.request.host_url);

class ConnectHandler(webapp2.RequestHandler):
    def get(self):
        pass

webapp2_config = {}
webapp2_config['webapp2_extras.sessions'] = {
    'secret_key': 'ldjaf;lksdjf;l  alsjdfl asldkj0q2k'
    }

app = webapp2.WSGIApplication([
    ('/', HomepageHandler),
    ('/login', LoginHandler),
    #('/activities', ActivitiesHandler),
    ('/profile', ProfileHandler),
    ('/api/activities', ActivityListHandler),
    ('/api/streams', ActivityListHandler),
    ],
                              config=webapp2_config,
                              debug=True)
