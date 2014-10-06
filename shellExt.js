'use strict';
/* Xcraft busclient shell extensions */

module.exports = function() {
  var route;
  var settings = {};

  route = function(req, res, next) {
    var app;
    app = req.shell;

    if (settings.workspace === null) {
      settings.workspace = app.set('workspace');
    }
    if (settings.config === null) {
      settings.config = '';
    }

    app.cmd('busclient', 'Info about busclient', function(req, res, next) {
      res.cyan('todo: map all registry command handlers').ln();
      return res.prompt();
    });

    return next();
  };
  if (arguments.length === 1) {
    settings = arguments[0];
    return route;
  } else {
    return route.apply(null, arguments);
  }
};
