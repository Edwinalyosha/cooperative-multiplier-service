import React, { useState } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  TextInputProps,
} from 'react-native';

interface PasswordInputProps extends Omit<TextInputProps, 'secureTextEntry'> {
  testID?: string;
}

export function PasswordInput({ testID, ...props }: PasswordInputProps) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <View className="flex-row items-center bg-white border border-slate-200 rounded-xl px-4">
      <TextInput
        {...props}
        testID={testID}
        secureTextEntry={!isVisible}
        className="flex-1 py-4 text-foreground text-base"
        placeholderTextColor="#94A3B8"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <TouchableOpacity
        testID={testID ? `${testID}-toggle` : undefined}
        onPress={() => setIsVisible((v) => !v)}
        accessibilityLabel={isVisible ? 'Hide password' : 'Show password'}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text className="text-slate-400 text-sm">
          {isVisible ? '🙈' : '👁'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}
