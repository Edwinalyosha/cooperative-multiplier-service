import React, { useCallback, useRef, useState } from 'react';
import {
  FlatList,
  TouchableOpacity,
  Text,
  View,
  useWindowDimensions,
  ListRenderItemInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { jwtDecode } from 'jwt-decode';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { OnboardingDot } from '../components/onboarding-dot';

const ONBOARDING_KEY = 'onboarding_complete';
const ACCESS_TOKEN_KEY = 'auth_access_token';

interface PageConfig {
  id: string;
  title: string;
  subtitle: string;
  dark: boolean;
}

const viewabilityConfig = { viewAreaCoveragePercentThreshold: 50 };

const PAGES: PageConfig[] = [
  {
    id: 'security',
    title: 'Institutional Security',
    subtitle:
      'Welcome to Sagehive. Connected to your secure SACCO core engine via Apache Fineract.',
    dark: true,
  },
  {
    id: 'monitoring',
    title: 'Real-Time Oversight',
    subtitle:
      'Monitor member shares, approve credit lines, and audit asset pools directly from your mobile dashboard.',
    dark: false,
  },
  {
    id: 'access',
    title: 'Ready to Administer',
    subtitle:
      'Accounts are provisioned securely by your system administrator. Tap below to authenticate with your institutional credentials.',
    dark: true,
  },
];

function PageContent({
  children,
  visible,
}: {
  children: React.ReactNode;
  visible: boolean;
}) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(24);

  React.useEffect(() => {
    if (visible) {
      opacity.value = withDelay(80, withTiming(1, { duration: 400 }));
      translateY.value = withDelay(80, withTiming(0, { duration: 400 }));
    } else {
      opacity.value = 0;
      translateY.value = 24;
    }
  }, [visible, opacity, translateY]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return <Animated.View style={[{ flex: 1 }, animStyle]}>{children}</Animated.View>;
}

function MonitoringMockup() {
  const bars = [
    { label: 'Member Share Growth', pct: 72, color: '#0F766E' },
    { label: 'Loan Disbursal Overview', pct: 55, color: '#14B8A6' },
  ];

  return (
    <View
      style={{
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
        elevation: 4,
        width: '100%',
      }}
    >
      <Text
        style={{
          fontSize: 12,
          fontWeight: '600',
          color: '#64748B',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          marginBottom: 16,
        }}
      >
        Director Overview
      </Text>
      {bars.map((bar) => (
        <View key={bar.label} style={{ marginBottom: 16 }}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              marginBottom: 6,
            }}
          >
            <Text style={{ fontSize: 13, color: '#0F172A', fontWeight: '500' }}>
              {bar.label}
            </Text>
            <Text style={{ fontSize: 13, color: bar.color, fontWeight: '600' }}>
              {bar.pct}%
            </Text>
          </View>
          <View
            style={{
              height: 8,
              backgroundColor: '#F1F5F9',
              borderRadius: 4,
              overflow: 'hidden',
            }}
          >
            <View
              style={{
                height: 8,
                width: `${bar.pct}%`,
                backgroundColor: bar.color,
                borderRadius: 4,
              }}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

export function OnboardingScreen() {
  const { width } = useWindowDimensions();
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<FlatList<PageConfig>>(null);

  React.useEffect(() => {
    (async () => {
      try {
        const token = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
        if (token) {
          const { exp } = jwtDecode<{ exp: number }>(token);
          if (exp > Date.now() / 1000 + 60) {
            router.replace('/(app)');
          }
        }
      } catch {
        // No valid token — stay on onboarding
      }
    })();
  }, []);

  const handleNext = useCallback(() => {
    if (activeIndex < PAGES.length - 1) {
      listRef.current?.scrollToIndex({ index: activeIndex + 1, animated: true });
    }
  }, [activeIndex]);

  const handleProceed = useCallback(async () => {
    await SecureStore.setItemAsync(ONBOARDING_KEY, '1');
    router.replace('/(auth)/login');
  }, []);

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: Array<{ index: number | null }> }) => {
      if (viewableItems[0]?.index != null) {
        setActiveIndex(viewableItems[0].index);
      }
    },
    [],
  );

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<PageConfig>) => {
      const isActive = index === activeIndex;
      const isLast = index === PAGES.length - 1;

      const content = (
        <SafeAreaView
          style={{ flex: 1, width }}
          edges={['top', 'bottom', 'left', 'right']}
        >
          <PageContent visible={isActive}>
            <View
              style={{
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                paddingHorizontal: 28,
                paddingBottom: 120,
              }}
            >
              {index === 0 && (
                <View style={{ alignItems: 'center', marginBottom: 32 }}>
                  <View
                    style={{
                      width: 64,
                      height: 64,
                      backgroundColor: 'rgba(255,255,255,0.15)',
                      borderRadius: 16,
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginBottom: 12,
                    }}
                  >
                    <Text
                      style={{
                        color: '#FFFFFF',
                        fontSize: 28,
                        fontWeight: '800',
                      }}
                    >
                      S
                    </Text>
                  </View>
                  <Text
                    style={{
                      color: '#FFFFFF',
                      fontSize: 16,
                      fontWeight: '600',
                      letterSpacing: 1,
                    }}
                  >
                    SAGEHIVE
                  </Text>
                </View>
              )}

              {index === 1 && (
                <View style={{ width: '100%', marginBottom: 32 }}>
                  <MonitoringMockup />
                </View>
              )}

              <Text
                style={{
                  fontSize: 26,
                  fontWeight: '800',
                  color: item.dark ? '#FFFFFF' : '#0F172A',
                  textAlign: 'center',
                  marginBottom: 12,
                }}
              >
                {item.title}
              </Text>
              <Text
                style={{
                  fontSize: 14,
                  lineHeight: 22,
                  color: item.dark ? 'rgba(255,255,255,0.75)' : '#64748B',
                  textAlign: 'center',
                  maxWidth: 300,
                }}
              >
                {item.subtitle}
              </Text>
            </View>

            <View
              style={{
                position: 'absolute',
                bottom: 40,
                left: 0,
                right: 0,
                alignItems: 'center',
                paddingHorizontal: 28,
              }}
            >
              <View
                style={{
                  flexDirection: 'row',
                  marginBottom: 24,
                  alignItems: 'center',
                }}
              >
                {PAGES.map((_, i) => (
                  <OnboardingDot
                    key={i}
                    active={i === activeIndex}
                    lightBackground={!item.dark}
                  />
                ))}
              </View>

              {isLast ? (
                <TouchableOpacity
                  onPress={handleProceed}
                  accessibilityRole="button"
                  accessibilityLabel="Proceed to Secure Login"
                  style={{
                    backgroundColor: '#FFFFFF',
                    borderRadius: 14,
                    height: 52,
                    width: '100%',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text
                    style={{
                      color: '#0F766E',
                      fontWeight: '700',
                      fontSize: 16,
                    }}
                  >
                    Proceed to Secure Login
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  onPress={handleNext}
                  accessibilityRole="button"
                  accessibilityLabel="Next"
                  style={{
                    alignSelf: 'flex-end',
                    backgroundColor: item.dark ? '#14B8A6' : '#0F766E',
                    borderRadius: 14,
                    height: 48,
                    paddingHorizontal: 28,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text
                    style={{
                      color: '#FFFFFF',
                      fontWeight: '700',
                      fontSize: 15,
                    }}
                  >
                    Next →
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </PageContent>
        </SafeAreaView>
      );

      if (item.dark) {
        return (
          <LinearGradient
            colors={['#0F766E', '#0F172A']}
            start={{ x: 0, y: 0 }}
            end={{ x: 0.3, y: 1 }}
            style={{ width, flex: 1 }}
          >
            {content}
          </LinearGradient>
        );
      }

      return (
        <View style={{ width, flex: 1, backgroundColor: '#F8FAFC' }}>
          {content}
        </View>
      );
    },
    [activeIndex, width, handleNext, handleProceed],
  );

  return (
    <FlatList
      ref={listRef}
      data={PAGES}
      renderItem={renderItem}
      keyExtractor={(item) => item.id}
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      scrollEventThrottle={16}
      onViewableItemsChanged={onViewableItemsChanged}
      viewabilityConfig={viewabilityConfig}
      getItemLayout={(_, index) => ({
        length: width,
        offset: width * index,
        index,
      })}
    />
  );
}
