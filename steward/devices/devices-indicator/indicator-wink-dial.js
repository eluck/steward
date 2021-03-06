// http://www.quirky.com/shop/596-Nimbus

var util        = require('util')
  , devices     = require('./../../core/device')
  , steward     = require('./../../core/steward')
  , utility     = require('./../../core/utility')
  , broker      = utility.broker
  , indicator   = require('./../device-indicator')
  ;


var logger = indicator.logger;


var Gauge = exports.Device = function(deviceID, deviceUID, info) {
  var self = this;

  self.whatami = info.deviceType;
  self.deviceID = deviceID.toString();
  self.deviceUID = deviceUID;
  self.name = info.device.name;

  self.info = {};
  self.gateway = info.gateway;
  self.update(self, info.params);

  self.status = 'present';
  self.changed();

  broker.subscribe('beacon-egress', function(category, data) {
    var i;

    if (category !== '.updates') return;

    if (!util.isArray(data)) data = [ data ];
    for (i = 0; i < data.length; i++) if (data[i].whoami === self.info.actor) self.egress(self);
  });

  broker.subscribe('actors', function(request, eventID, actor, observe, parameter) {
    if (actor !== ('device/' + self.deviceID)) return;

    if ((request === 'perform') && (observe === 'set')) return self.perform(self, eventID, observe, parameter);
  });

  self.getState(function(err, state) {
    if (!!err) return logger.error('device/' + self.deviceID, { event: 'getState', diagnostic: err.message});
    if (!state) return;

    self.info.actor = state.actor;
    self.info.property = state.property;
    if ((!!self.info.actor) && (!!self.info.property)) self.egress(self);
  });
};
util.inherits(Gauge, indicator.Device);


Gauge.prototype.update = function(self, params) {
  var updateP;

  self.params = params;
  updateP = false;

  if (self.params.name !== self.name) {
    self.name = self.params.name;
    updateP = true;
  }

  if (updateP) self.changed();
};

Gauge.prototype.egress = function(self) {
  var label, value;

  if (!self.gateway.wink) return;

  label = self.info.property.split('.');
  label = label[label.length - 1];
  if (self.info.property.indexOf('.[') !== -1) {
    value = devices.expand(self.info.property, self.info.actor);
    if (!value) return;
  } else {
    value = devices.expand('.[' + self.info.actor + '.' + self.info.property + '].');
    if (!value) return;
    if ((label.length + 1 + value.length) <= 8) value = label + ' ' + value;
  }

  self.gateway.wink.setDial(self.params, { name                  : devices.expand('.[' + self.info.actor + '.name].')
                                         , label                 : value
                                         , labels                : [ value, '' ]
                                         , position              : 0
                                         , brightness            : 75
                                         , channel_configuration : { channel_id: 10 }
                                         }, function(err, params) {
    if (!!err) return logger.error('device/' + self.deviceID, { event: 'setDial', diagnostic: err.message});

    if (!!params) self.update(self, params);
  });
};


Gauge.prototype.perform = function(self, taskID, perform, parameter) {
  var params;

  try { params = JSON.parse(parameter); } catch(ex) { params = {}; }

  if (perform !== 'set') return false;

  if (!!params.name) {
    if (!self.gateway.wink) return false;

    self.gateway.wink.setDevice(self.params, { name: params.name }, function(err, params) {
      if (!!err) return logger.error('device/' + self.deviceID, { event: 'setDevice', diagnostic: err.message});

      if (!!params) self.update(self, params);
    });
  }

  if (!!params.actor) self.info.actor = params.actor;
  if (!!params.property) self.info.property = params.property;
  if ((!!params.actor) || (!!params.property)) self.setState({ actor: self.info.actor, property: self.info.property });

  return steward.performed(taskID);
};

var validate_perform = function(perform, parameter) {
  var params = {}
    , result = { invalid: [], requires: [] }
    ;

  if (!!parameter) try { params = JSON.parse(parameter); } catch(ex) { result.invalid.push('parameter'); }

  if (perform !== 'set') {
    result.invalid.push('perform');
    return result;
  }

  if (!!params.actor) {
    if ((typeof params.actor !== 'string') || (params.actor.spit('/').length !== 2)) result.invalid.push('actor');
  }
  if ((!!params.property) && (typeof params.property !== 'string')) result.invalid.push('property');

  return result;
};



exports.start = function() {
  steward.actors.device.indicator.wink = steward.actors.device.indicator.wink ||
      { $info     : { type: '/device/indicator/wink' } };

  steward.actors.device.indicator.wink.gauge =
      { $info     : { type       : '/device/indicator/wink/gauge'
                    , observe    : [ ]
                    , perform    : [ ]
                    , properties : { name     : true
                                   , status   : [ 'present' ]
                                   , actor    : true
                                   , property : true
                                   }
                    }
      , $validate : { perform    : validate_perform
                    }
      };
  devices.makers['/device/indicator/wink/gauge'] = Gauge;
};
