import { Audio } from 'expo-av';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { NodeServerInterface } from '../server/node-server-interface';

export default function EmbeddedCamera() {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const server = useRef(new NodeServerInterface()).current;
  const [message, setMessage] = useState('');
  const recordingRef = useRef<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const imageSavedRef = useRef(false);
  const promptSavedRef = useRef(false);
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  useEffect(() => {
    const lock = async () => {
      try {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
      } catch {}
    };
    lock();
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, []);

  const startCaptureAndRecord = async () => {
    try {
      const photo = await cameraRef.current?.takePictureAsync({
        base64: true,
        quality: 0.8,
        skipProcessing: true,
      });
      if (photo) {
        try {
          // Re-encode to JPEG base64 to ensure consistent format
          const processed = await ImageManipulator.manipulateAsync(
            photo.uri,
            [],
            { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true }
          );
          console.log('client image base64 length:', processed.base64 ? processed.base64.length : 0);
          await server.addImage(processed);
          imageSavedRef.current = true;
        } catch (e: any) {
          imageSavedRef.current = false;
          Alert.alert('Image error', e?.message ?? 'Failed to save captured image');
          return;
        }
      } else {
        imageSavedRef.current = false;
        Alert.alert('Capture failed', 'No photo captured');
        return;
      }

      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        Alert.alert('Microphone permission required');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });

      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await recording.startAsync();
      recordingRef.current = recording;
      setIsRecording(true);
    } catch (e: any) {
      Alert.alert('Failed to start recording', e?.message ?? String(e));
    }
  };

  const stopRecordAndProcess = async () => {
    if (!recordingRef.current) return;
    try {
      const rec = recordingRef.current;
      await rec.stopAndUnloadAsync();
      const uri = rec.getURI();
      recordingRef.current = null;
      setIsRecording(false);

      if (uri) {
        const transcript = (await server.transcribeAudioFromFile(uri, 'audio/m4a'))?.trim();
        if (transcript && transcript.length > 0) {
          server.addPrompt(transcript);
          promptSavedRef.current = true;
        } else {
          promptSavedRef.current = false;
          Alert.alert('Transcription failed', 'No speech detected or transcription failed.');
          return;
        }
      } else {
        promptSavedRef.current = false;
        Alert.alert('Recording failed', 'No audio URI produced.');
        return;
      }

      if (!imageSavedRef.current) {
        Alert.alert('Missing image', 'Image was not captured or saved');
        return;
      }

      if (!promptSavedRef.current) {
        Alert.alert('Missing prompt', 'Prompt was not captured or saved');
        return;
      }

      const reply = await server.getResponse();
      if (reply) setMessage(reply);
    } catch (e: any) {
      Alert.alert('Failed to stop/process recording', e?.message ?? String(e));
      setIsRecording(false);
      recordingRef.current = null;
    }
  };

  if (!permission) return null;
  if (!permission.granted) {
    return <Button title="Grant camera access" onPress={requestPermission} />;
  }
  
  return (
    <View style={styles.container}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />
      {isLandscape && (
        <View style={[styles.sidebar, { width: Math.round(width * 0.25), height }]}>
          <View style={styles.sidebarContent}>
            <Text style={styles.sidebarTitle}>ARIA</Text>

            <View style={styles.flexSpacer} />

            <TextInput
              placeholder="Your message..."
              placeholderTextColor="#363737"
              style={styles.textInput}
              value={message}
              onChangeText={setMessage}
            />

            <Pressable
              style={[styles.recordButton, isRecording && { opacity: 0.8 }]}
              onPressIn={startCaptureAndRecord}
              onPressOut={stopRecordAndProcess}
            >
              <Text style={styles.recordLabel}>{isRecording ? 'Recording…' : 'Hold to Record'}</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'black' },
  // Set right: 0 if you prefer the sidebar on the right side
  sidebar: {
    position: 'absolute',
    right: 12,
    top: 12,
    bottom: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.52)',
    borderRadius: 16,
    padding: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 6, height: 6 },
    elevation: 8,
  },
  sidebarContent: { flex: 1, padding: 12, paddingBottom: 24 },
  sidebarTitle: { color: 'white', fontSize: 16, marginBottom: 8, fontWeight: '600', textAlign: 'center' },
  textInput: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    color: 'white',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  flexSpacer: { flex: 1 },
  recordButton: {
    backgroundColor: '#FF3B30',
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    marginTop: 8,
  },
  recordLabel: { color: 'white', fontWeight: '600' },
});