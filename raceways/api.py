# this class is effectively a proxy for the subset of the strava API
# that is needed for this tool, using the oauth authentication of the
# current user. The only important distinction is the caching that is
# done inherently in StravaClient
from raceways.handler import BaseHandler, using_template, authorized, api_handler
from functools import wraps

def api_handler(f):
    @wraps(f)
    def wrapper(self, *args, **kwds):
        result = f(self, *args, **kwds)
        
        self.response.cache_control.max_age = 30
        self.response.cache_control.no_cache = False
        
        self.response.headers['content-type'] = 'text/plain'

        # use cors to allow cross-domain requests
        self.response.headers['Access-Control-Allow-Origin'] = '*'
        self.response.write(json.encode(result, indent=4, default=json_default_encode))
        
    return wrapper

# gets a list of activities, without streams
class ActivityListHandler(BaseHandler):
    @api_handler
    @authorized
    def get(self):
        if self.request.get('id'):
            athlete_id = self.request.get('id')
        else:
            athlete_id = self.get_athlete()['id']
            
        page = 1
        per_page = 10

        try:
            page = int(self.request.get('page'))
        except ValueError as e:
            pass

        try:
            per_page = int(self.request.get('per_page'))
        except ValueError as e:
            pass

        activities = strava.athlete_activities(id=athlete_id, page=page, per_page=per_page)

        return activities
            
class StreamHandler(BaseHandler):
    @api_handler
    @authorized
    def get(self):
        activity_id = self.request.get('id')
        type = self.request.get('type') or 'latlng'
        resolution = self.request.get('resolution') or None
        series_type = self.request.get('series_type') or None

        stream = activity_stream(id=activity_id, type=type, resolution=resolution, series_type=series_type)

        return stream
    
