'use strict';

var moduleName = 'bus-command';

var xLog = require ('xcraft-core-log') (moduleName);
var xBus = require ('xcraft-core-bus');

var utils = require ('./utils.js');


module.exports = function (push, registry, events) {
  return {
    /**
     * Send a command on the bus.
     *
     * If a callback is specified, the finished topic is automatically
     * subscribed to the events bus. Then when the callback is called, the
     * topic is unsubscribed.
     *
     * @param {string} cmd - Command's name.
     * @param {Object} [data] - Map of arguments passed to the command.
     * @param {function(err, results)} [finishHandler] - Callback.
     */
    send: function (cmd, data, finishHandler) {
      if (finishHandler) {
        /* Subscribe to end command notification. */
        var finishTopic = utils.topicModifier (cmd + '.finished');
        events.subscribe (finishTopic);

        registry[finishTopic] = function (msg) {
          events.unsubscribe (finishTopic);
          finishHandler (null, msg);
        };

        xLog.verb ('finish handler registered for cmd: ' + cmd);
      }

      var busMessage = xBus.newMessage ();

      busMessage.data = data;

      xLog.verb ('client send \'%s\' command', cmd);
      push.send (cmd, busMessage);
    }
  };
};
