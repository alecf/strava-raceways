



class FetchHandler(BaseHandler):

    @authorized
    @api_handler
    @ndb.toplevel
    def get(self):
        result = { 'fetchtest': True }


        return fetchtest


        
