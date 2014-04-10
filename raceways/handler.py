import os
import webapp2
import httplib2
from stravalib import unithelper
from functools import wraps
import time
import json


from google.appengine.api import users, memcache
from oauth2client.appengine import StorageByKeyName
from oauth2client.client import flow_from_clientsecrets

from raceways.model import RacewaysUser
from raceways import JINJA_ENVIRONMENT
from raceways import util
from raceways.client import StravaClient

CLIENT_SECRETS = os.path.join(os.path.dirname(os.path.dirname(__file__)),
                              "client_secret.json")
STRAVA_SECRETS = os.path.join(os.path.dirname(os.path.dirname(__file__)),
                              "strava_secret.json")

class NoStravaUser(BaseException):
    pass

def using_template(template_name):
    def call_wrapper(f):
        @wraps(f)
        def wrapper(self, *args, **kwds):
            result = f(self, *args, **kwds)
            template = self.get_template(template_name)
            defaults = self.get_defaults()
            result.update(defaults)
            self.response.write(template.render(result))
        return wrapper
    return call_wrapper

def json_default_encode(o):
   try:
       iterable = iter(o)
   except TypeError:
       pass
   else:
       return list(iterable)
   if isinstance(o, datetime):
       return o.isoformat()
   # Let the base class default method raise the TypeError
   return JSONEncoder.default(o)

def api_handler(f):
    @wraps(f)
    def wrapper(self, *args, **kwds):

        # allow 30-second caching for refreshes
        self.response.cache_control.max_age = 30
        self.response.cache_control.no_cache = False
        
        self.response.headers['content-type'] = 'text/plain'

        # use cors to allow cross-domain requests
        self.response.headers['Access-Control-Allow-Origin'] = '*'
        
        print "Running wrapper"
        try:
            result = f(self, *args, **kwds)
            envelope = {
                "result": result,
                "status": "SUCCESS",
                }
        except Exception as e:
            envelope = {
                "result": "ERROR",
                "messages": [str(e)]
                }
        print "wrapper done"
            
        self.response.write(json.encode(envelope, indent=4, default=json_default_encode))
        
    return wrapper

def authorized(f):
    @wraps(f)
    def wrapper(self, *args, **kwds):
        if not self.user or not self.strava_storage.get():
            print "Redirecting..."
            return self.redirect('/')
        strava_credentials = self.strava_storage.get()
        
        strava_credentials.authorize(self.http)
        return f(self, *args, **kwds)
    return wrapper

class BaseHandler(webapp2.RequestHandler):
    def dispatch(self):
        self.deadline = time.time() + 58        # 60 seconds plus buffer
        self.http = httplib2.Http(memcache)
        
        self.user = users.get_current_user()
        
        if self.user:
            self.strava_storage = StorageByKeyName(RacewaysUser, self.user.user_id(), 'strava_credentials')
        # note that authorization has not happened yet
        self.strava = StravaClient(self.http)

        # where do we use this?
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

    def get_athlete(self):
        strava_credentials = self.strava_storage.get()
        if not strava_credentials:
            raise NoStravaUser()
        strava_credentials_json = json.loads(strava_credentials.to_json())
        from pprint import pprint
        #pprint(strava_credentials_json)
        return strava_credentials_json['token_response']['athlete']
