/// Based on https://github.com/Lavisx/lidl-valve-z2m/blob/main/lidl_radiator_valve.js
//// Usage:
// tuya_radiator_valve.js in the root of your zigbee2mqtt data folder (as stated in data_path, e.g. /config/zigbee2mqtt_data)
// In your zigbee2mqtt hassio addon configuration, add the following two lines:
// ...
// external_converters:
//   - tuya_radiator_valve.js
// ...
const fz = {...require('zigbee-herdsman-converters/converters/fromZigbee'), legacy: require('zigbee-herdsman-converters/lib/legacy').fromZigbee};
const tz = require('zigbee-herdsman-converters/converters/toZigbee');
const tuya = require('zigbee-herdsman-converters/lib/tuya');
const globalStore = require('zigbee-herdsman-converters/lib/store');
const exposes = require('zigbee-herdsman-converters/lib/exposes');
const reporting = require('zigbee-herdsman-converters/lib/reporting');
const e = exposes.presets;
const ea = exposes.access;

const tuyaLocal = {
    dataPoints: {
        zsMode: 2,
        zsHeatingSetpoint: 16,
        zsLocalTemp: 24,
        zsChildLock: 40,
    },
};
const fzLocal = {
    zs_thermostat: {
        cluster: 'manuSpecificTuya',
        type: ['commandGetData', 'commandSetDataResponse'],
        convert: (model, msg, publish, options, meta) => {
            const dp = msg.data.dp;
            const value = tuya.getDataValue(msg.data.datatype, msg.data.data);

            switch (dp) {

            case tuyaLocal.dataPoints.zsChildLock:
                return {child_lock: value ? 'LOCK' : 'UNLOCK'};

            case tuyaLocal.dataPoints.zsHeatingSetpoint:
                return {current_heating_setpoint: (value / 10).toFixed(1)};

            case tuyaLocal.dataPoints.zsLocalTemp:
                return {local_temperature: (value / 10).toFixed(1)};

            case tuyaLocal.dataPoints.zsMode:
                switch (value) {
                case 0: // auto
                    return {away_mode: 'OFF', preset: 'schedule'};
                case 1: // manual
                    return {away_mode: 'OFF', preset: 'manual'};
                case 3: // holiday
                    return {away_mode: 'ON', preset: 'holiday'};
                default:
                    meta.logger.warn('zigbee-herdsman-converters:zsThermostat: ' +
                        `preset ${value} is not recognized.`);
                    break;
                }
                break;
            default:
                meta.logger.warn(`zigbee-herdsman-converters:zsThermostat: Unrecognized DP #${dp} with data ${JSON.stringify(msg.data)}`);
            }
        },
    },
};
const tzLocal = {
    zs_thermostat_child_lock: {
        key: ['child_lock'],
        convertSet: async (entity, key, value, meta) => {
            await tuya.sendDataPointBool(entity, tuyaLocal.dataPoints.zsChildLock, value === 'LOCK');
        },
    },
    zs_thermostat_current_heating_setpoint: {
        key: ['current_heating_setpoint'],
        convertSet: async (entity, key, value, meta) => {
            await tuya.sendDataPointValue(entity, tuyaLocal.dataPoints.zsHeatingSetpoint, Math.round(value * 10));
        },
    },
    zs_thermostat_preset_mode: {
        key: ['preset'],
        convertSet: async (entity, key, value, meta) => {
            const lookup = {'schedule': 0, 'manual': 1, 'holiday': 3};
            await tuya.sendDataPointEnum(entity, tuyaLocal.dataPoints.zsMode, lookup[value]);
            if (value == 'manual') {
                const temp = globalStore.getValue(entity, 'current_heating_setpoint');
                if (temp) {
                    await tuya.sendDataPointValue(entity, tuyaLocal.dataPoints.zsHeatingSetpoint, Math.round(temp * 10));
                }
            }
        },
    },
};
const device = {
    // Tuya Radiator Valve
    zigbeeModel: ['TS601'],
    fingerprint: [{modelID: 'TS0601', manufacturerName: '_TZE200_hue3yfsn'}],
    model: '?',
    vendor: 'Tuya',
    description: 'Radiator valve with thermostat',
    fromZigbee: [
        fz.ignore_basic_report,
        fz.ignore_tuya_set_time,
        fzLocal.zs_thermostat,
    ],
    toZigbee: [
        tzLocal.zs_thermostat_current_heating_setpoint,
        tzLocal.zs_thermostat_child_lock,
        tzLocal.zs_thermostat_preset_mode,
    ],
    onEvent: tuya.onEventSetLocalTime,
    meta: {},
    configure: async (device, coordinatorEndpoint, logger) => {
        const endpoint = device.getEndpoint(1);
        await reporting.bind(endpoint, coordinatorEndpoint, ['genBasic']);
    },
    exposes: [
        e.child_lock(),
        exposes.climate().withSetpoint('current_heating_setpoint', 0.5, 29.5, 0.5)
                         .withLocalTemperature()
                         .withLocalTemperatureCalibration()
                         .withPreset(['schedule', 'manual', 'holiday']),
            ],
};

module.exports = device;
