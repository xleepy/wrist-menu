let installedDevice = null;

export async function installQuest2IwerRuntime() {
  if (installedDevice) return installedDevice;
  const { XRDevice, metaQuest2 } = await import("iwer");
  installedDevice = new XRDevice(metaQuest2);
  installedDevice.installRuntime({ forceInstall: true });
  installedDevice.primaryInputMode = "controller";
  return installedDevice;
}
