import React from 'react';
import Animated, {
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';

interface OnboardingDotProps {
  active: boolean;
  lightBackground?: boolean;
}

export function OnboardingDot({ active, lightBackground = false }: OnboardingDotProps) {
  const animStyle = useAnimatedStyle(() => ({
    width: withTiming(active ? 24 : 8, { duration: 250 }),
    opacity: withTiming(active ? 1 : 0.4, { duration: 250 }),
  }));

  const baseColor = lightBackground ? '#0F766E' : '#FFFFFF';

  return (
    <Animated.View
      style={[
        {
          height: 8,
          borderRadius: 4,
          backgroundColor: baseColor,
          marginHorizontal: 3,
        },
        animStyle,
      ]}
    />
  );
}
