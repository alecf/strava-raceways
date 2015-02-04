Polymer('facet-list', {
    publish: { facets: [] },
    selectors: function() {
        return this.shadowRoot.querySelectorAll('facet-selector');
    },
    // creates a filter from the current state of the UI controls, where the filter is in the form
    // [[key, value], [key, value]]
    // the key, value will be passed to matches?
    getFilterValues: function() {
        var results = [];
        var selectors = this.selectors();
        for (var i = 0; i < selectors.length; i++) {
            var selector = selectors[i];
            var filters = selector.filterValues();
            results = results.concat(filters);
        }
        return results;
    },
    onFacetValue: function(e) {
        console.log("onFacetValue(", e, ")");
    },
});
