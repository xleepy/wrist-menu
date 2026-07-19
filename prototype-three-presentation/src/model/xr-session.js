function safeSessionValue(session, key) {
  try {
    return session?.[key] ?? null;
  } catch {
    return null;
  }
}

export function listXrInputSources(session) {
  try {
    const inputSources = session?.inputSources;
    if (!inputSources || typeof inputSources[Symbol.iterator] !== "function") return [];
    return [...inputSources];
  } catch {
    return [];
  }
}

export function snapshotXrSession(session, describeInputSource = (inputSource) => inputSource) {
  const inputSources = [];
  for (const inputSource of listXrInputSources(session)) {
    try {
      inputSources.push(describeInputSource(inputSource));
    } catch {
      // XR runtimes may detach individual input sources while dispatching teardown.
    }
  }

  return {
    frameRate: safeSessionValue(session, "frameRate"),
    visibilityState: safeSessionValue(session, "visibilityState"),
    inputSources,
  };
}

export async function endXrSession(session) {
  try {
    await session.end();
    return "ended";
  } catch (error) {
    if (error?.name === "InvalidStateError") return "already-ended";
    throw error;
  }
}
