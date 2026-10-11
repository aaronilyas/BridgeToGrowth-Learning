import React from 'react';
import { router } from 'expo-router';
import { View } from 'react-native';
import { LessonScreen } from '../../src/lesson-screen';
import { Button } from '../../src/ui';
export default function Lessons() { return <View style={{ flex: 1 }}><Button label="Account" onPress={() => router.push('/account')} secondary /><LessonScreen /></View>; }
