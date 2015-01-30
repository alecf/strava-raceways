Polymer('profile-page', {
    'facetSelected': function(e) {
        console.log("Filters should be updated with ", e.facet.id, " = ", e.value.value);
    },
    'ready': function() {
        console.log("profile-page ready");

        Profile.init();
        /* this.$.sample.facet.name = 'City';
         this.$.sample.values.push({name: "Berkeley", count: 100});
         this.addEventListener('core-select', function(e, detail, ex) {
         console.log("Selected: ", this, ": ", e, detail, ex);
         }); */
    },
});
