import React from 'react';
import { Stack } from 'expo-router';
export default function Layout() { return <Stack screenOptions={{ headerTintColor: '#183b35', headerStyle: { backgroundColor: '#f6f7f2' } }}><Stack.Screen name="index" options={{ title: 'Lessons' }} /><Stack.Screen name="account" options={{ title: 'Account' }} /><Stack.Screen name="phone" options={{ title: 'Change phone' }} /></Stack>; }
