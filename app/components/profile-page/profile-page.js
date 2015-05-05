console.log("Starting the profile page...");
Polymer('profile-page', {
    publish: {
        totalActivities: 0,
        resolution: 'high',
    },
    facetSelected: function(e) {
        console.log("Filters should be updated with ", e.facet.id, " = ", e.value ? e.value.value.value : null);
        this.profile.refresh();
    },
    ready: function() {
        console.log("profile-page ready");
        if (window.google && window.google.identitytoolkit) {
            window.google.identitytoolkit.signInButton(
                this.$.signin, // accepts any CSS selector
                {
                    widgetUrl: window.location.origin + "/oauth2callback",
                    signOutUrl: window.location.origin + "/logout",
                }
            );
        }

        var querystring = window.location.search.slice(1).split('&');
        var params = _(querystring)
                .map(function(s) { return s.split('='); })
                .object()
                .value();
        this.resolution = params.resolution || this.resolution;
        this.profile = new Profile(this, this.resolution);
        this.profile.init();

    },
    onRefresh: function() {
        if (this.$.refreshAjax.loading) return;
        this.$['refresh-button'].icon = 'radio-button-off';
        var params = this.$.refreshAjax.params = {
            count: 30
        };
        if (this.resolution) {
            params.resolution = this.resolution;
        }
        this.$.refreshAjax.go();
    },
    onDataLoaded: function() {
        this.$['refresh-button'].icon = 'refresh';
        this.profile.refresh();
    },
    onSplitterMove: function(e) {
        this.job('splitter-resize', function() {
            console.log("splitter moved", e);
            this.profile.onResize();
        }, 200);
    },

    on2dScroll: function(e) {
        console.log("2d scrolling");
    },
});
