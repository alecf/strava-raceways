
from google.appengine.ext import ndb
from oauth2client.appengine import CredentialsNDBProperty

class RacewaysUser(ndb.Model):
    strava_credentials = CredentialsNDBProperty()

class Athlete(ndb.Model):
    resource_state = ndb.IntegerProperty()
    firstname = ndb.StringProperty()
    lastname = ndb.StringProperty()
    profile_medium = ndb.StringProperty() 
    profile = ndb.StringProperty() 
    city = ndb.StringProperty()
    state = ndb.StringProperty()
    country = ndb.StringProperty()
    sex = ndb.StringProperty() 
    friend = ndb.StringProperty() # 'pending', 'accepted', 'blocked' or
                                  # 'null' the authenticated athlete's
                                  # following status of this athlete
    follower = ndb.StringProperty() # 'pending', 'accepted', 'blocked'
                                    # or 'null' this athlete's following
                                    # status of the authenticated
                                    # athlete

    premium = ndb.BooleanProperty()
    created_at = ndb.StringProperty() # time string
    updated_at = ndb.StringProperty() # time string
    approve_followers = ndb.BooleanProperty() # if has enhanced privacy enabled
    follower_count = ndb.IntegerProperty()
    friend_count = ndb.IntegerProperty()
    mutual_friend_count = ndb.IntegerProperty()
    date_preference = ndb.StringProperty()
    measurement_preference = ndb.StringProperty() # 'feet' or 'meters'
    email = ndb.StringProperty()
    ftp = ndb.IntegerProperty()
    clubs = ndb.JsonProperty(repeated=True) # array of summary representations of the athlete's clubs
    bikes = ndb.JsonProperty(repeated=True) # array of summary representations of the athlete's bikes
    shoes = ndb.JsonProperty(repeated=True) # array of summary representations of the athlete's shoes


class Activity(ndb.Model):
    resource_state = ndb.IntegerProperty()  # indicates level of detail
    external_id = ndb.StringProperty()  # provided at upload
    activity_id = ndb.IntegerProperty()
    #athlete = ndb.JsonProperty() # meta or summary representation of the athlete
    athlete_id = ndb.IntegerProperty()
    name = ndb.StringProperty()
    distance = ndb.FloatProperty() # meters
    moving_time = ndb.IntegerProperty() # seconds
    elapsed_time = ndb.IntegerProperty() # seconds
    total_elevation_gain = ndb.FloatProperty() # meters
    type = ndb.StringProperty()  # activity type, ie. ride, run, swim, etc.
    start_date = ndb.StringProperty()
    start_date_local = ndb.StringProperty() # time string
    time_zone = ndb.StringProperty()
    start_latlng = ndb.JsonProperty() # [latitude, longitude]
    end_latlng = ndb.JsonProperty() # [latitude, longitude]
    location_city = ndb.StringProperty()
    location_state = ndb.StringProperty()
    location_country = ndb.StringProperty()
    achievement_count = ndb.IntegerProperty()
    kudos_count = ndb.IntegerProperty()
    comment_count = ndb.IntegerProperty()
    athlete_count = ndb.IntegerProperty()
    photo_count = ndb.IntegerProperty()
    map = ndb.JsonProperty()  # detailed representation of the route
    trainer = ndb.BooleanProperty()
    commute = ndb.BooleanProperty()
    manual = ndb.BooleanProperty()
    private = ndb.BooleanProperty()
    flagged = ndb.BooleanProperty()
    gear_id = ndb.StringProperty()  #corresponds to a bike or pair of shoes included in athlete details
    gear = ndb.JsonProperty() # gear summary
    average_speed = ndb.FloatProperty() # meters per second
    max_speed = ndb.FloatProperty() # meters per second
    average_cadence = ndb.FloatProperty()  # RPM, if provided at upload
    average_temp = ndb.IntegerProperty() # degrees Celsius, if provided at upload
    average_watts = ndb.FloatProperty() # rides only
    kilojoules = ndb.FloatProperty() # rides only  - uses estimated power if necessary
    average_heartrate = ndb.IntegerProperty() # only if recorded with heartrate average over moving portion
    max_heartrate = ndb.IntegerProperty() # only if recorded with heartrate
    calories = ndb.FloatProperty() # kilocalories, uses kilojoules for rides and speed/pace for runs
    truncated = ndb.IntegerProperty() # only present if activity is owned by authenticated athlete, returns 0 if not truncated by privacy zones
    has_kudoed = ndb.BooleanProperty()  # if the authenticated athlete has kudoed this activity
    segment_efforts = ndb.JsonProperty() # array of summary representations of the segment efforts
    splits_metric = ndb.JsonProperty() # array of metric split summaries - running activities only
    splits_standard = ndb.JsonProperty() # array of standard split summaries - running activities only
    best_efforts = ndb.JsonProperty() # array of best effort summaries - running activities only

class Stream(ndb.Model):
    version = 4
    type = ndb.StringProperty()
    data = ndb.JsonProperty()
    activity_id = ndb.IntegerProperty()  # not used right now, this is embedded in the id
    series_type = ndb.StringProperty()
    original_size = ndb.IntegerProperty()
    resolution = ndb.StringProperty()   # low, medium or high

    @classmethod
    def make_key_string(cls, activity_id, stream_type, resolution=None):
        if not resolution:
            return "{}|v={}|type={}".format(activity_id, cls.version, stream_type)
        else:
            print "resolution is '{}'".format(resolution)
            return "{}|v={}|type={}|resolution={}".format(
                activity_id, cls.version, stream_type, resolution)

