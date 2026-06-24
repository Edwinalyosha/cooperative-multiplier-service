import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StatusBar,
} from 'react-native';

interface SessionExpiredModalProps {
  visible: boolean;
  onSignInAgain: () => void;
}

export function SessionExpiredModal({
  visible,
  onSignInAgain,
}: SessionExpiredModalProps) {
  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => {
        // Intentionally non-dismissible — user must press CTA
      }}
    >
      <StatusBar backgroundColor="rgba(0,0,0,0.6)" />
      <View className="flex-1 bg-black/60 items-center justify-center px-6">
        <View className="bg-white rounded-2xl p-6 w-full max-w-sm">
          <Text className="text-destructive text-lg font-bold mb-2">
            Session Expired
          </Text>
          <Text className="text-slate-600 text-sm leading-relaxed mb-6">
            Your session has expired. Please sign in again to continue.
          </Text>
          <TouchableOpacity
            onPress={onSignInAgain}
            className="bg-destructive rounded-xl py-3 items-center"
            accessibilityRole="button"
          >
            <Text className="text-white font-semibold text-base">
              Sign In Again
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
