#!/usr/bin/env python3
"""
Performance Testing Script for Trading App
Tests backend API endpoints, database queries, and generates a performance report.
"""

import time
import requests
import statistics
import json
from datetime import datetime
from typing import List, Dict
import sys

# Configuration
BASE_URL = "http://localhost:8000"
API_BASE = f"{BASE_URL}/api"

class PerformanceTest:
    def __init__(self):
        self.results = {
            "timestamp": datetime.now().isoformat(),
            "backend_tests": {},
            "summary": {}
        }
        
    def test_endpoint(self, endpoint: str, method: str = "GET", params: dict = None, 
                     data: dict = None, headers: dict = None, num_requests: int = 10) -> Dict:
        """Test an API endpoint multiple times and return statistics"""
        print(f"Testing {method} {endpoint}...")
        times = []
        errors = 0
        response_sizes = []
        
        for i in range(num_requests):
            try:
                start = time.time()
                if method == "GET":
                    response = requests.get(f"{API_BASE}{endpoint}", params=params, 
                                          headers=headers, timeout=10)
                elif method == "POST":
                    response = requests.post(f"{API_BASE}{endpoint}", json=data, 
                                           headers=headers, timeout=10)
                else:
                    continue
                    
                elapsed = time.time() - start
                times.append(elapsed * 1000)  # Convert to milliseconds
                
                if response.status_code >= 400:
                    errors += 1
                    
                if hasattr(response, 'headers') and 'content-length' in response.headers:
                    response_sizes.append(int(response.headers['content-length']))
                else:
                    response_sizes.append(len(response.content))
                    
            except Exception as e:
                errors += 1
                print(f"  Error on request {i+1}: {e}")
        
        if not times:
            return {"error": "All requests failed"}
            
        return {
            "endpoint": endpoint,
            "method": method,
            "requests": num_requests,
            "errors": errors,
            "avg_time_ms": round(statistics.mean(times), 2),
            "min_time_ms": round(min(times), 2),
            "max_time_ms": round(max(times), 2),
            "median_time_ms": round(statistics.median(times), 2),
            "p95_time_ms": round(sorted(times)[int(len(times) * 0.95)], 2) if times else 0,
            "avg_response_size_bytes": round(statistics.mean(response_sizes), 2) if response_sizes else 0,
            "success_rate": round((num_requests - errors) / num_requests * 100, 2)
        }
    
    def run_all_tests(self):
        """Run all performance tests"""
        print("=" * 60)
        print("Trading App Performance Test Suite")
        print("=" * 60)
        print()
        
        # Test basic connectivity
        print("1. Testing Backend Connectivity...")
        try:
            response = requests.get(f"{BASE_URL}/docs", timeout=5)
            if response.status_code == 200:
                print("   ✓ Backend is running")
            else:
                print(f"   ✗ Backend returned status {response.status_code}")
                return
        except Exception as e:
            print(f"   ✗ Cannot connect to backend: {e}")
            print("   Please ensure the backend server is running on port 8000")
            return
        
        print()
        
        # Test endpoints (with minimal parameters to avoid errors)
        endpoints = [
            ("/trades/", "GET", {"status": "OPEN"}, None),
            ("/payins/", "GET", None, None),
            ("/snapshots/", "GET", {"limit": 10}, None),
        ]
        
        print("2. Testing API Endpoints...")
        for endpoint, method, params, data in endpoints:
            result = self.test_endpoint(endpoint, method, params, data, num_requests=10)
            if "error" not in result:
                self.results["backend_tests"][endpoint] = result
                print(f"   {endpoint}:")
                print(f"     Avg: {result['avg_time_ms']}ms, "
                      f"Median: {result['median_time_ms']}ms, "
                      f"P95: {result['p95_time_ms']}ms")
                print(f"     Success Rate: {result['success_rate']}%")
            else:
                print(f"   {endpoint}: {result['error']}")
            print()
        
        # Generate summary
        if self.results["backend_tests"]:
            avg_times = [v["avg_time_ms"] for v in self.results["backend_tests"].values()]
            self.results["summary"] = {
                "total_endpoints_tested": len(self.results["backend_tests"]),
                "overall_avg_response_time_ms": round(statistics.mean(avg_times), 2),
                "overall_max_response_time_ms": round(max(avg_times), 2),
                "overall_min_response_time_ms": round(min(avg_times), 2)
            }
        
        print("3. Performance Summary...")
        if self.results["summary"]:
            print(f"   Total Endpoints Tested: {self.results['summary']['total_endpoints_tested']}")
            print(f"   Overall Avg Response Time: {self.results['summary']['overall_avg_response_time_ms']}ms")
            print(f"   Fastest Endpoint: {self.results['summary']['overall_min_response_time_ms']}ms")
            print(f"   Slowest Endpoint: {self.results['summary']['overall_max_response_time_ms']}ms")
        
    def save_report(self, filename: str = "performance_report.json"):
        """Save performance report to file"""
        with open(filename, 'w') as f:
            json.dump(self.results, f, indent=2)
        print(f"\n✓ Performance report saved to {filename}")

def analyze_frontend_bundle():
    """Analyze frontend bundle sizes"""
    print("\n4. Analyzing Frontend Bundle...")
    try:
        import os
        dist_dir = "frontend/dist/assets"
        if os.path.exists(dist_dir):
            total_size = 0
            files = {}
            for filename in os.listdir(dist_dir):
                filepath = os.path.join(dist_dir, filename)
                if os.path.isfile(filepath):
                    size = os.path.getsize(filepath)
                    size_kb = size / 1024
                    size_mb = size_kb / 1024
                    files[filename] = {
                        "size_bytes": size,
                        "size_kb": round(size_kb, 2),
                        "size_mb": round(size_mb, 2)
                    }
                    total_size += size
            
            total_kb = total_size / 1024
            total_mb = total_kb / 1024
            
            print(f"   Total Bundle Size: {round(total_mb, 2)} MB ({round(total_kb, 2)} KB)")
            for filename, info in files.items():
                print(f"   {filename}: {info['size_mb']} MB ({info['size_kb']} KB)")
            
            # Check gzip sizes if available
            print("\n   Recommendation: Enable gzip compression in production")
            return {
                "total_size_mb": round(total_mb, 2),
                "total_size_kb": round(total_kb, 2),
                "files": files
            }
        else:
            print("   ✗ Frontend dist directory not found. Run 'npm run build' first.")
            return None
    except Exception as e:
        print(f"   ✗ Error analyzing frontend: {e}")
        return None

if __name__ == "__main__":
    tester = PerformanceTest()
    tester.run_all_tests()
    
    frontend_results = analyze_frontend_bundle()
    if frontend_results:
        tester.results["frontend_bundle"] = frontend_results
    
    tester.save_report()
    
    print("\n" + "=" * 60)
    print("Performance Testing Complete!")
    print("=" * 60)

