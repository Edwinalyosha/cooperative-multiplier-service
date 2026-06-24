import React, { useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { LinearGradient } from 'expo-linear-gradient';
import { loginSchema, LoginFormData } from '../validators/login.schema';
import { PasswordInput } from '../components/password-input';
import { useAuthStore } from '../store/auth.store';

export function LoginScreen() {
  const { login, isLoading, error, clearError } = useAuthStore();

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    mode: 'onSubmit',
    defaultValues: { username: '', password: '' },
  });

  useEffect(() => {
    return () => {
      clearError();
    };
  }, [clearError]);

  const onSubmit = async (data: LoginFormData) => {
    clearError();
    await login(data);
  };

  return (
    <LinearGradient
      colors={['#0F766E', '#0F172A']}
      start={{ x: 0, y: 0 }}
      end={{ x: 0.3, y: 1 }}
      className="flex-1"
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
        >
          <View className="flex-1 items-center justify-center px-6 py-12">
            {/* Floating card */}
            <View className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl">
              {/* Brand */}
              <View className="items-center mb-6">
                <View className="w-12 h-12 bg-primary rounded-xl items-center justify-center mb-3">
                  <Text className="text-white text-xl font-bold">S</Text>
                </View>
                <Text className="text-foreground text-lg font-bold">
                  SageHive
                </Text>
                <Text className="text-slate-500 text-xs mt-0.5">
                  Director Console
                </Text>
              </View>

              {/* Username field */}
              <View className="mb-4">
                <Controller
                  control={control}
                  name="username"
                  render={({ field: { onChange, value } }) => (
                    <TextInput
                      placeholder="Username"
                      value={value}
                      onChangeText={onChange}
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="username"
                      returnKeyType="next"
                      className="bg-background border border-slate-200 rounded-xl px-4 py-4 text-foreground text-base"
                      placeholderTextColor="#94A3B8"
                      editable={!isLoading}
                    />
                  )}
                />
                {errors.username && (
                  <Text className="text-destructive text-xs mt-1 ml-1">
                    {errors.username.message}
                  </Text>
                )}
              </View>

              {/* Password field */}
              <View className="mb-4">
                <Controller
                  control={control}
                  name="password"
                  render={({ field: { onChange, value } }) => (
                    <PasswordInput
                      placeholder="Password"
                      value={value}
                      onChangeText={onChange}
                      autoComplete="password"
                      returnKeyType="done"
                      onSubmitEditing={handleSubmit(onSubmit)}
                      editable={!isLoading}
                      testID="login-password"
                    />
                  )}
                />
                {errors.password && (
                  <Text className="text-destructive text-xs mt-1 ml-1">
                    {errors.password.message}
                  </Text>
                )}
              </View>

              {/* API error */}
              {error && (
                <View className="bg-red-50 border border-destructive/20 rounded-lg p-3 mb-4">
                  <Text className="text-destructive text-sm">{error}</Text>
                </View>
              )}

              {/* Submit */}
              <TouchableOpacity
                testID="login-submit"
                onPress={handleSubmit(onSubmit)}
                disabled={isLoading}
                accessibilityState={{ disabled: isLoading }}
                className={`rounded-xl py-4 items-center ${
                  isLoading ? 'bg-primary/60' : 'bg-primary'
                }`}
              >
                {isLoading ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text className="text-white font-semibold text-base">
                    Sign In
                  </Text>
                )}
              </TouchableOpacity>

              {/* Security note */}
              <Text className="text-slate-400 text-xs text-center mt-4">
                🔒 Secured connection
              </Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}
