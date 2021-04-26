import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import colorConvert from 'color-convert';
import { ANIMATION_MODE_STATIC } from './lib/animationModes';
import sp108e, { sp108eStatus } from './lib/sp108e';
import { Sp108ePlatform } from './platform';
import { MANUFACTURER, MODEL } from './settings';
import { CHIP_TYPES, RGBW_CHIP_TYPES } from './lib/chipTypes';
import { COLOR_ORDERS } from './lib/colorOrders';

const POLL_INTERVAL = 1000;

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class Sp108ePlatformAccessory {
  private debug: boolean;
  private device: sp108e;
  private rgbService: Service;
  private wService!: Service;
  private asService: Service;

  private lastPull!: Date;
  private deviceStatus!: sp108eStatus;
  private dreamModeOn!: boolean;

  constructor(
    private readonly platform: Sp108ePlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.debug = accessory.context.device.debug;

    this.platform.log.info(accessory.context.device);

    // instantiate sp108e
    this.device = new sp108e(accessory.context.device);

    this.initialize(accessory.context.device);

    this.sync();

    const serialNumberBase = `${accessory.context.device.host}:${accessory.context.device.port}`;

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name)
      .setCharacteristic(this.platform.Characteristic.Manufacturer, MANUFACTURER)
      .setCharacteristic(this.platform.Characteristic.Model, MODEL)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, serialNumberBase);

    // rgb led
    const rgbServiceName = accessory.context.device.name + ' Color';
    this.rgbService = this.accessory.getService(rgbServiceName) ||
      this.accessory.addService(this.platform.Service.Lightbulb, rgbServiceName, `${serialNumberBase}/rgb`);

    this.rgbService.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOn.bind(this))
      .onGet(this.getOn.bind(this));

    this.rgbService.getCharacteristic(this.platform.Characteristic.Brightness)
      .onSet(this.setBrightness.bind(this))
      .onGet(this.getBrightness.bind(this));

    this.rgbService
      .getCharacteristic(this.platform.Characteristic.Hue)
      .onSet(this.setHue.bind(this))
      .onGet(this.getHue.bind(this));

    this.rgbService
      .getCharacteristic(this.platform.Characteristic.Saturation)
      .onSet(this.setSaturation.bind(this))
      .onGet(this.getSaturation.bind(this));

    // white led
    if (RGBW_CHIP_TYPES.includes(accessory.context.device?.chip)) {
      const wServiceName = accessory.context.device.name + ' White';
      this.wService = this.accessory.getService(wServiceName) ||
        this.accessory.addService(this.platform.Service.Lightbulb, wServiceName, `${serialNumberBase}/w`);

      this.wService.getCharacteristic(this.platform.Characteristic.Brightness)
        .onSet(this.setWhiteBrightness.bind(this))
        .onGet(this.getWhiteBrightness.bind(this));
    }

    // animation speed
    const asServicename = accessory.context.device.name + ' Animation Speed';
    this.asService = this.accessory.getService(asServicename) ||
      this.accessory.addService(this.platform.Service.Fanv2, asServicename, `${serialNumberBase}/as`);

    this.asService
      .getCharacteristic(this.platform.Characteristic.Active)
      .onSet(this.setDreamModeOn.bind(this))
      .onGet(this.getDreamModeOn.bind(this));

    this.asService
      .getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .onSet(this.setAnimationSpeed.bind(this))
      .onGet(this.getAnimationSpeed.bind(this));
  }

  async initialize({ chip, colorOrder, segments, ledsPerSegment }) {
    this.dreamModeOn = false;

    await this.pollStatus();
    if (typeof this.deviceStatus === 'undefined') {
      this.platform.log.error('Unable to poll status during initialization');
      return;
    }

    const chipIndex = CHIP_TYPES.indexOf(chip);
    if (this.deviceStatus?.icType !== chipIndex) {
      this.debug && this.platform.log.info('setting chip type ->', chip);
      await this.device.setChipType(chip);
    }

    const colorOrderIndex = COLOR_ORDERS.indexOf(colorOrder);
    if (this.deviceStatus?.colorOrder !== colorOrderIndex) {
      this.debug && this.platform.log.info('setting color order ->', colorOrder);
      await this.device.setColorOrder(colorOrder);
    }

    if (this.deviceStatus?.numberOfSegments !== segments) {
      this.debug && this.platform.log.info('setting segments ->', segments);
      await this.device.setSegments(segments);
    }

    if (this.deviceStatus?.ledsPerSegment !== ledsPerSegment) {
      this.debug && this.platform.log.info('setting LEDs per segment ->', ledsPerSegment);
      await this.device.setLedsPerSegment(ledsPerSegment);
    }
  }

  sync() {
    setInterval(async () => {
      await this.pollStatus();
    }, POLL_INTERVAL);
  }

  async pollStatus() {
    try {
      this.deviceStatus = await this.device.getStatus();
      this.lastPull = new Date();
    } catch (e) {
      this.platform.log.error('Pull error ->', e);
    }
  }

  isOutOfSync() {
    return this.deviceStatus === undefined ||
      this.lastPull === undefined ||
      (new Date().getUTCMilliseconds()) - this.lastPull.getUTCMilliseconds() > POLL_INTERVAL;
  }

  async setOn(value: CharacteristicValue) {
    if (Boolean(value) === this.deviceStatus.on) {
      this.debug && this.platform.log.info('Characteristic On is already ->', value);
      return;
    }

    try {
      if (value) {
        await this.device.on();
      } else {
        await this.device.off();
      }

      this.debug && this.platform.log.info('Set Characteristic On ->', value);
    } catch (e) {
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async getOn(): Promise<CharacteristicValue> {
    if (this.isOutOfSync()) {
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    this.debug && this.platform.log.info('Get Status', this.deviceStatus);

    const isOn = this.deviceStatus.on;

    this.debug && this.platform.log.info('Get Characteristic On ->', isOn);

    // if you need to return an error to show the device as "Not Responding" in the Home app:
    // throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);

    return isOn;
  }

  async setBrightness(value: CharacteristicValue) {
    try {
      await this.device.setBrightnessPercentage(value as number);

      this.debug && this.platform.log.info('Set Characteristic Brightness -> ', value);
    } catch (e) {
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async getBrightness(): Promise<CharacteristicValue> {
    if (this.isOutOfSync()) {
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    this.debug && this.platform.log.info('Get Status', this.deviceStatus);

    const brightness = this.deviceStatus.brightnessPercentage;

    this.debug && this.platform.log.info('Get Characteristic Brightness -> ', brightness);

    return brightness;
  }

  async setHue(value: CharacteristicValue) {
    try {
      this.debug && this.platform.log.info('Set Characteristic Hue -> ', value);
      const colorHex = colorConvert.hsv.hex([value as number, this.deviceStatus.hsv.saturation, this.deviceStatus.hsv.value]);
      await this.device.setColor(colorHex);
    } catch (e) {
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async getHue(): Promise<CharacteristicValue> {
    if (this.isOutOfSync()) {
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    this.debug && this.platform.log.info('Get Status', this.deviceStatus);

    const hue = this.deviceStatus.hsv.hue;

    this.debug && this.platform.log.info('Get Characteristic Hue -> ', hue);

    return hue;
  }

  async setSaturation(value: CharacteristicValue) {
    try {
      this.debug && this.platform.log.info('Set Characteristic Saturation -> ', value);
      const colorHex = colorConvert.hsv.hex([this.deviceStatus.hsv.hue, value as number, this.deviceStatus.hsv.value]);
      await this.device.setColor(colorHex);
    } catch (e) {
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async getSaturation(): Promise<CharacteristicValue> {
    if (this.isOutOfSync()) {
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    this.debug && this.platform.log.info('Get Status', this.deviceStatus);

    const saturation = this.deviceStatus.hsv.saturation;

    this.debug && this.platform.log.info('Get Characteristic Saturation -> ', saturation);

    return saturation;
  }

  async setWhiteBrightness(value: CharacteristicValue) {
    try {
      await this.device.setWhiteBrightnessPercentage(value as number);

      this.debug && this.platform.log.info('Set Characteristic Brightness of w -> ', value);
    } catch (e) {
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async getWhiteBrightness(): Promise<CharacteristicValue> {
    if (this.isOutOfSync()) {
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    this.debug && this.platform.log.info('Get Status', this.deviceStatus);

    const whiteBrightness = this.deviceStatus.whiteBrightnessPercentage;

    this.debug && this.platform.log.info('Get Characteristic Brightness of w -> ', whiteBrightness);

    return whiteBrightness;
  }

  async setDreamModeOn(value: CharacteristicValue) {
    try {
      this.dreamModeOn = value as boolean;
      value
        ? this.device.setDreamModeAuto()
        : this.device.setAnimationMode(ANIMATION_MODE_STATIC);

      this.debug && this.platform.log.info('Set Characteristic Active of as -> ', value);
    } catch (e) {
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async getDreamModeOn(): Promise<CharacteristicValue> {
    const dreamModeOn = this.dreamModeOn ?
      this.platform.api.hap.Characteristic.Active.ACTIVE :
      this.platform.api.hap.Characteristic.Active.INACTIVE;

    this.debug && this.platform.log.info('Get Characteristic Active of as -> ', dreamModeOn);

    return dreamModeOn;
  }

  async setAnimationSpeed(value: CharacteristicValue) {
    try {
      await this.device.setAnimationSpeedPercentage(value as number);

      this.debug && this.platform.log.info('Set Characteristic RotationSpeed of as -> ', value);
    } catch (e) {
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async getAnimationSpeed(): Promise<CharacteristicValue> {
    if (this.isOutOfSync()) {
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    this.debug && this.platform.log.info('Get Status', this.deviceStatus);

    const animationSpeed = this.deviceStatus.animationSpeedPercentage;

    this.debug && this.platform.log.info('Get Characteristic RotationSpeed of as -> ', animationSpeed);

    return animationSpeed;
  }
}
