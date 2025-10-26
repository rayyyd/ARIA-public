import { Stack } from "expo-router";
import EmbeddedCamera from "./camera";

export default function Index() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <EmbeddedCamera />
    </>
  );
}
