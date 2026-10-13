require 'json'
package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name = 'EduverseStore'
  s.version = package['version']
  s.summary = package['description']
  s.license = 'Commercial'
  s.homepage = 'https://example.com'
  s.author = 'EduVerse'
  s.source = { :git => 'https://example.com/eduverse-store.git', :tag => s.version.to_s }
  s.source_files = 'ios/Sources/**/*.{swift,h,m,c,cc,mm,cpp}'
  s.ios.deployment_target = '15.0'
  s.dependency 'Capacitor'
  s.swift_version = '5.9'
  s.frameworks = 'StoreKit', 'CloudKit', 'GameKit', 'Vision', 'Speech', 'AVFoundation'
end
