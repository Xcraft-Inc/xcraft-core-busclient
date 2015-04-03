'use strict';

var busClient = require ('..');


exports.topicModifier = function (topic) {
  if (/.*::.*/.test (topic)) {
    return topic;
  }

  return busClient.getStateWhich () + '::' + topic;
};
