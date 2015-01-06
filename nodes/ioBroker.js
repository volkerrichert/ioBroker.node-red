/**
 * Copyright 2013,2014 IBM Corp.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/

module.exports = function(RED) {
    "use strict";
    var util = require("util");
    var utils = require(__dirname + '/../lib/utils');
    //var redis = require("redis");
    var hashFieldRE = /^([^=]+)=(.*)$/;
	// Get the redis address

	var settings = require(process.env.NODE_RED_HOME+"/red/red").settings;
    var instance = settings.get("iobrokerInstance") || 0;
    var config   = settings.get("iobrokerConfig");
    if (typeof config == 'string') {
        config = JSON.parse(config);
    }

    try {
        var adapter = utils.adapter({name: 'node-red', instance: instance, config: config});
    } catch(e) {
        console.log(e);
    }
    var nodes = [];
    var ready = false;

    adapter.on("ready", function () {
        ready = true;
        adapter.subscribeForeignStates('*');
        while (nodes.length) {
            var node = nodes.pop();
            if (node instanceof IOBrokerInNode)
                adapter.on('stateChange', node.stateChange);
            node.status({fill:"green",shape:"dot",text:"connected"});
        }
    });

    // name is like system.state, pattern is like "*.state" or "*" or "*system*"
    function getRegex(pattern) {
        if (!pattern || pattern == '*') return null;
        if (pattern.indexOf('*') == -1) return null;
        if (pattern[pattern.length - 1] != '*') pattern = pattern + '$';
        if (pattern[0] != '*') pattern = '^' + pattern;
        pattern = pattern.replace(/\*/g, '[a-zA-Z0-9.\s]');
        return new RegExp(pattern);
    }

    function IOBrokerInNode(n) {
        var node = this;
        RED.nodes.createNode(node,n);
        node.topic = (n.topic || '*').replace(/\//g, '.');

        // If no adapter prefix, add own adapter prefix
        if (node.topic && node.topic.indexOf('.') == -1) {
            node.topic = adapter.namespace + '.' + node.topic;
        }

        node.regex = getRegex(this.topic);
        node.payloadType = n.payloadType;

        if (ready) {
            node.status({fill:"green",shape:"dot",text:"connected"});
        } else {
            node.status({fill:"red",shape:"ring",text:"disconnected"},true);
        }

        node.stateChange = function(topic, obj) {
            if (node.regex) {
                if (!node.regex.exec(topic)) return;
            } else if (node.topic != '*' && node.topic != topic) {
                return;
            }

            node.send({
                topic:       topic.replace(/\./g, '/'),
                payload:     (node.payloadType == 'object') ? obj : (obj.val === null || obj.val === undefined) ? '' : obj.val.toString(),
                acknowledged:obj.ack,
                timestamp:   obj.ts,
                lastchange:  obj.lc,
                from:        obj.from
            });
        };

        node.on('close', function() {
            adapter.removeListener('stateChange', node.stateChange);
        });

        if (ready) {
            adapter.on('stateChange', node.stateChange);
        } else {
            nodes.push(node);
        }
    }
    RED.nodes.registerType("ioBroker in",IOBrokerInNode);

    function IOBrokerOutNode(n) {
        var node = this;
        RED.nodes.createNode(node,n);
        node.topic = n.topic;

        node.ack = (n.ack === "true" || n.ack === true);
        node.autoCreate = (n.autoCreate === "true" || n.autoCreate === true);
        node.regex = new RegExp("^node-red\." + instance);

        if (ready) {
            node.status({fill:"green",shape:"dot",text:"connected"});
        } else {
            node.status({fill:"red",shape:"ring",text:"disconnected"},true);
        }

        function setState(id, val, ack) {
            adapter.getObject(id, function (err, obj) {
                if (!obj) {
                    if (!node.autoCreate) {
                        adapter.log.warn('State "' + id + '" does not exist in the ioBroker.');
                        return;
                    }
                    adapter.log.warn('State "' + id + '" was created in the ioBroker as ' + adapter._fixId(id));
                    // Create object
                    adapter.setObject(id, {
                        common: {
                            name: id,
                            role: 'info'
                        },
                        native: {},
                        type: 'state'
                    }, function (err, obj) {
                        if (val != '__create__') {
                            adapter.setState(id, {val: val, ack: ack});
                        } else {
                            adapter.setState(id, {val: null, ack: ack});
                        }
                    });
                } else {
                    if (val != '__create__') {
                        adapter.setState(id, {val: val, ack: ack});
                    }
                }
            });
        }

        node.on("input", function(msg) {
            var id = node.topic || msg.topic;
            if (id) {
                id = id.replace(/\//g, '.');
                // If not this adapter state
                if (!node.regex.exec(id) && id.indexOf('.') != -1) {
                    // Check if state exists
                    adapter.getForeignState(id, function (obj) {
                        if (obj) {
                            adapter.setForeignState(id, {val: msg.payload, ack: node.ack});
                        } else {
                            adapter.log.warn('State "' + id + '" does not exist in the ioBroker')
                        }
                    });
                } else {
                    setState(id, msg.payload, node.ack);
                }
            } else {
                node.warn("No key or topic set");
            }
        });
        if (!ready) {
            nodes.push(node);
        }

        //node.on("close", function() {
//
//        });

    }
    RED.nodes.registerType("ioBroker out",IOBrokerOutNode);
}
