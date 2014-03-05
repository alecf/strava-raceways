import os
import webapp2
import httplib2
from stravalib import unithelper
import json

from google.appengine.api import users, memcache
from oauth2client.appengine import StorageByKeyName
#from google.appengine.api import oauth, users, memcache
from oauth2client.client import flow_from_clientsecrets
from raceways.model import RacewaysUser
from raceways import JINJA_ENVIRONMENT
from raceways import util

CLIENT_SECRETS = os.path.join(os.path.dirname(os.path.dirname(__file__)),
                              "client_secret.json")
STRAVA_SECRETS = os.path.join(os.path.dirname(os.path.dirname(__file__)),
                              "strava_secret.json")

def using_template(template_name):
    def call_f(outer_f):
        def f(self, *args, **kwds):
            print "Calling {}".format(outer_f)
            result = outer_f(self, *args, **kwds)
            print "Got result: {}".format(result.keys())
            template = self.get_template(template_name)
            defaults = self.get_defaults()
            result.update(defaults)
            print "And now with defautls: {}".format(result.keys())
            self.response.write(template.render(result))
        return f
    return call_f
            

            
        

class BaseHandler(webapp2.RequestHandler):
    def dispatch(self):
        self.http = httplib2.Http(memcache)
        
        self.user = users.get_current_user()

        if self.user:
            self.strava_storage = StorageByKeyName(RacewaysUser, self.user.user_id(), 'strava_credentials')
                
        self.strava_flow = flow_from_clientsecrets(
            STRAVA_SECRETS,
            scope="view_private",
            redirect_uri=self.request.host_url + '/login')
        
        
        webapp2.RequestHandler.dispatch(self)

    def get_defaults(self):
        return {            # modules
            'unithelper': unithelper,
            'json': json,
            'formats': util,            # ugh name collision with 'util'
            }
    def get_template(self, name):
        return JINJA_ENVIRONMENT.get_template(name)
