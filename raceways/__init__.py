import os
import urllib

import jinja2

JINJA_ENVIRONMENT = jinja2.Environment(
    loader=jinja2.FileSystemLoader(
        os.path.join(os.path.dirname(os.path.dirname(__file__)),
                     'templates')),
    extensions=['jinja2.ext.autoescape'],
    autoescape=True)

