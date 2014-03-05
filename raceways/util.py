
# much of this stolen from stravalib
import pytz
from datetime import datetime

def reformat_date(datestring, source, athlete):
    timezone = source['timezone'].split(' ')[-1]
    tzinfo = pytz.timezone(timezone)
    date = datetime.strptime(datestring, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=tzinfo)

    localdate = date.strftime(athlete['date_preference'])

    return localdate
